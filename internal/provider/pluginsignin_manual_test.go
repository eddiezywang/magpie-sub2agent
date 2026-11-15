//go:build intranet

package provider

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/testenv"
)

func TestIntranetPluginManualCallbackAndAutomaticCompletion(t *testing.T) {
	bun := testenv.Bun(t)
	claudeHome(t)
	t.Setenv("MAGPIE_BUN", bun)
	t.Cleanup(plugin.Settle)
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"manual-fixture","version":"1.0.0","type":"module","main":"index.js"}`), 0600)
	os.WriteFile(filepath.Join(dir, "index.js"), []byte(`export default async()=>({
 config:async cfg=>{cfg.provider??={};cfg.provider['sub2agent-workbuddy']={name:'WorkBuddy fixture',npm:'@ai-sdk/openai-compatible',api:'http://fixture.invalid',models:{fixture:{name:'Fixture'}}}},
 auth:{provider:'sub2agent-workbuddy',methods:[{type:'oauth',label:'Browser',authorize:async()=>{
 let complete;const received=new Promise(resolve=>complete=resolve);
 return {method:'auto',url:'https://fixture.invalid/login',instructions:'Automatic + manual',
 submitCallback:async raw=>{if(raw!=='https://www.workbuddy.cn/login/?state=fixture')throw new Error('wrong callback');complete()},
 callback:async()=>{await received;return {type:'success',access:'fixture-access',refresh:'',expires:0,accountId:'fixture-user'}}}
 }}]}})`), 0600)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, err := plugin.Add(ctx, dir); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.Providers(ctx); err != nil {
		t.Fatal(err)
	}
	st, err := StartPluginSignIn("sub2agent-workbuddy", 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !st.PasteCallback {
		t.Fatal("automatic sign-in did not expose manual callback")
	}
	if err := SubmitSignInCallback(st.ID, "https://wrong.invalid/?state=fixture"); err == nil {
		t.Fatal("invalid callback accepted")
	}
	if current, _ := SignInStatus(st.ID); current.State != "waiting" {
		t.Fatal("invalid callback ended automatic sign-in")
	}
	if err := SubmitSignInCallback(st.ID, "https://www.workbuddy.cn/login/?state=fixture"); err != nil {
		t.Fatal(err)
	}
	if current, _ := SignInStatus(st.ID); current.State != "done" {
		t.Fatalf("manual callback failed to complete: %s", current.State)
	}
	entries, err := plugin.AuthEntries()
	if err != nil || len(entries) != 1 {
		t.Fatalf("expected exactly one saved account, got %d: %v", len(entries), err)
	}
}
