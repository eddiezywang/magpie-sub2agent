package shortcut

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/distribution"
)

// appPath is where Win+R and `start magpie` look magpie.exe up: the user's
// own, no administrator needed. A var so the test writes a key of its own.
var appPath = registryPath(`App Paths`, "magpie.exe", "sub2agent.exe")

func registerAppPath(exe string) {
	if k, _, err := registry.CreateKey(registry.CURRENT_USER, appPath, registry.SET_VALUE); err == nil {
		_ = k.SetStringValue("", exe)
		_ = k.SetStringValue("Path", filepath.Dir(exe))
		k.Close()
	}
	registerUninstall(exe)
}

// uninstallKey is magpie's entry in Settings › Apps › Installed apps (and
// Control Panel's Programs and Features), the user's own. With none,
// Windows' own way to remove a program didn't list magpie, so it was
// deleted by hand, which runs no code: Codex kept openai_base_url on a
// gateway that was gone (Jevik_AI on X). Its Uninstall runs magpie's own
// (UninstallCommand), which puts every agent back first. A var so the
// test writes a key of its own.
var uninstallKey = registryPath(`Uninstall`, "magpie", "sub2agent")

func registryPath(section, upstream, internal string) string {
	if distribution.Internal {
		upstream = internal
	}
	return `Software\Microsoft\Windows\CurrentVersion\` + section + `\` + upstream
}

// registerUninstall writes the entry for exe, at every start, so it
// follows an exe that was moved.
func registerUninstall(exe string) {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, uninstallKey, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer k.Close()
	for name, v := range map[string]string{
		"DisplayName":     Name,
		"DisplayIcon":     exe + ",0",
		"Publisher":       Name,
		"InstallLocation": filepath.Dir(exe),
		"UninstallString": UninstallCommand(exe),
		"URLInfoAbout":    aboutURL(),
	} {
		_ = k.SetStringValue(name, v)
	}
	// Uninstall is the one button: there is nothing to modify or repair
	_ = k.SetDWordValue("NoModify", 1)
	_ = k.SetDWordValue("NoRepair", 1)
}

func aboutURL() string {
	if distribution.Internal {
		return "https://sub2agent.com"
	}
	return "https://usemagpie.ai"
}

// unregisterUninstall takes the entry out while it is exe's, or its exe
// is gone; another magpie's stays.
func unregisterUninstall(exe string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, uninstallKey, registry.QUERY_VALUE)
	if err != nil {
		return nil // none
	}
	v, _, err := k.GetStringValue("DisplayIcon")
	k.Close()
	v = strings.TrimSuffix(v, ",0")
	if err == nil && v != "" && !strings.EqualFold(filepath.Clean(v), filepath.Clean(exe)) {
		if _, err := os.Stat(v); err == nil {
			return nil // another magpie's
		}
	}
	return registry.DeleteKey(registry.CURRENT_USER, uninstallKey)
}

func registeredAppPath() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, appPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	k.Close()
	return true
}

func startMenuLink() (string, error) {
	dir, err := programs()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, Name+".lnk"), nil
}

func writeShortcut(lnk, exe string) (bool, error) { return write(lnk, exe) }

// programs is the user's Start menu Programs folder.
func programs() (string, error) {
	if p, err := windows.KnownFolderPath(windows.FOLDERID_Programs, windows.KF_FLAG_CREATE); err == nil && p != "" {
		return p, nil
	}
	a := appdir.Getenv("APPDATA")
	if a == "" {
		return "", errors.New("no Start menu folder")
	}
	p := filepath.Join(a, `Microsoft\Windows\Start Menu\Programs`)
	return p, os.MkdirAll(p, 0o755)
}

// write has the shortcut at lnk open exe, in exe's folder, with its icon,
// and reports whether it had to: one already opening exe is left as it is.
// It is Windows' own shell link, made by the shell's WScript.Shell.
func write(lnk, exe string) (bool, error) {
	// COM is set up per thread; this one keeps the goroutine
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
		var oe *ole.OleError
		switch {
		case !errors.As(err, &oe):
			return false, err
		case oe.Code() == 1: // S_FALSE: set up already, still ours to undo
			defer ole.CoUninitialize()
		case oe.Code() != 0x80010106: // RPC_E_CHANGED_MODE: set up otherwise, usable
			return false, err
		}
	} else {
		defer ole.CoUninitialize()
	}
	unk, err := oleutil.CreateObject("WScript.Shell")
	if err != nil {
		return false, err
	}
	defer unk.Release()
	shell, err := unk.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return false, err
	}
	defer shell.Release()
	// the shortcut at lnk, read in when there is one
	v, err := oleutil.CallMethod(shell, "CreateShortcut", lnk)
	if err != nil {
		return false, err
	}
	sc := v.ToIDispatch()
	defer sc.Release()
	prop := func(name string) string {
		p, err := oleutil.GetProperty(sc, name)
		if err != nil {
			return ""
		}
		defer p.Clear()
		return p.ToString()
	}
	if !Stale(prop("TargetPath"), prop("WorkingDirectory"), exe) && prop("Description") == Name {
		return false, nil
	}
	for name, val := range map[string]any{
		"TargetPath":       exe,
		"WorkingDirectory": filepath.Dir(exe),
		"IconLocation":     exe + ",0",
		"Description":      Name,
	} {
		if _, err := oleutil.PutProperty(sc, name, val); err != nil {
			return false, err
		}
	}
	if _, err := oleutil.CallMethod(sc, "Save"); err != nil {
		return false, err
	}
	return true, nil
}

// unregisterAppPath takes magpie's App Paths entry out while it opens exe,
// or an exe that is gone, and its Installed apps entry the same way.
func unregisterAppPath(exe string) error {
	uerr := unregisterUninstall(exe)
	k, err := registry.OpenKey(registry.CURRENT_USER, appPath, registry.QUERY_VALUE)
	if err != nil {
		return uerr // none
	}
	v, _, err := k.GetStringValue("")
	k.Close()
	if err == nil && v != "" && !strings.EqualFold(filepath.Clean(v), filepath.Clean(exe)) {
		if _, err := os.Stat(v); err == nil {
			return uerr // another magpie's
		}
	}
	return errors.Join(uerr, registry.DeleteKey(registry.CURRENT_USER, appPath))
}

// migrateLegacy replaces only the old shortcut that this installation recorded
// and whose target still points to its executable. Other installations are untouched.
func migrateLegacy(exe, state, link string) error {
	if !distribution.Internal {
		return nil
	}
	saved, err := os.ReadFile(state)
	if err != nil {
		return nil
	}
	legacyExe := Target(strings.TrimSpace(string(saved)))
	if !filepath.IsAbs(legacyExe) {
		return nil
	}
	removeOwnedLegacyRegistry(legacyExe)
	old := filepath.Join(filepath.Dir(link), "Magpie.lnk")
	if _, err := os.Stat(old); err != nil {
		return nil
	}
	target, err := readShortcutTarget(old)
	if err != nil || !strings.EqualFold(filepath.Clean(target), filepath.Clean(legacyExe)) {
		return err
	}
	if _, err := os.Stat(link); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if _, err := writeShortcut(link, exe); err != nil {
		return err
	}
	return os.Remove(old)
}

func readShortcutTarget(path string) (string, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
		var oe *ole.OleError
		if !errors.As(err, &oe) || (oe.Code() != 1 && oe.Code() != 0x80010106) {
			return "", err
		}
		if oe.Code() == 1 {
			defer ole.CoUninitialize()
		}
	} else {
		defer ole.CoUninitialize()
	}
	unk, err := oleutil.CreateObject("WScript.Shell")
	if err != nil {
		return "", err
	}
	defer unk.Release()
	shell, err := unk.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return "", err
	}
	defer shell.Release()
	v, err := oleutil.CallMethod(shell, "CreateShortcut", path)
	if err != nil {
		return "", err
	}
	sc := v.ToIDispatch()
	defer sc.Release()
	prop, err := oleutil.GetProperty(sc, "TargetPath")
	if err != nil {
		return "", err
	}
	defer prop.Clear()
	return prop.ToString(), nil
}

// Old releases wrote upstream registry paths; remove only entries that still
// name this exact executable, never an entry belonging to another installation.
func removeOwnedLegacyRegistry(exe string) {
	for _, entry := range []struct{ path, value string }{
		{`Software\Microsoft\Windows\CurrentVersion\App Paths\magpie.exe`, ""},
		{`Software\Microsoft\Windows\CurrentVersion\Uninstall\magpie`, "DisplayIcon"},
	} {
		k, err := registry.OpenKey(registry.CURRENT_USER, entry.path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		value, _, err := k.GetStringValue(entry.value)
		k.Close()
		value = strings.TrimSuffix(value, ",0")
		if err == nil && value != "" && strings.EqualFold(filepath.Clean(value), filepath.Clean(exe)) {
			_ = registry.DeleteKey(registry.CURRENT_USER, entry.path)
		}
	}
}
