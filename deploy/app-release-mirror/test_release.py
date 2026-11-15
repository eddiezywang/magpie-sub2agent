import hashlib, io, json, pathlib, subprocess, sys, tarfile, tempfile, unittest

HERE=pathlib.Path(__file__).resolve().parent

class ReleaseTests(unittest.TestCase):
    def test_multiple_assets_and_rejects_bad_checksum(self):
        with tempfile.TemporaryDirectory() as temp:
            tmp=pathlib.Path(temp); root=tmp/'releases'; root.mkdir(); version='0.6.1'
            files={'magpie-windows-amd64.exe':b'win','magpie-darwin-arm64.zip':b'arm','magpie-darwin-amd64.zip':b'intel'}
            manifest=json.dumps({'version':version,'assets':{n:{'size':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in files.items()}},separators=(',',':')).encode()
            def tar_with(override=None):
                archive=tmp/'release.tar'
                with tarfile.open(archive,'w') as tar:
                    for name,data in [('latest.json',manifest)]+[('assets/'+n,(override if override and n=='magpie-darwin-arm64.zip' else b)) for n,b in files.items()]:
                        info=tarfile.TarInfo(name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
                return archive
            # Execute the production installer with an isolated allowed root.
            script=(HERE/'apply-release.py').read_text(encoding='utf-8')
            start=script.index('allowed_roots = ');end=script.index('\n',start)
            script=script[:start]+'allowed_roots = {'+repr(str(root.resolve()))+'}'+script[end:]
            installer=tmp/'installer.py';installer.write_text(script,encoding='utf-8')
            def run(archive):return subprocess.run([sys.executable,str(installer),str(archive),str(root),version,hashlib.sha256(manifest).hexdigest()],capture_output=True,text=True)
            self.assertEqual(run(tar_with()).returncode,0)
            self.assertEqual((root/'latest.json').read_bytes(),manifest)
            for name,data in files.items():self.assertEqual((root/version/name).read_bytes(),data)
            self.assertEqual(run(tar_with()).returncode,0)
            self.assertNotEqual(run(tar_with(b'tampered')).returncode,0)
            self.assertEqual((root/'latest.json').read_bytes(),manifest)

if __name__=='__main__':unittest.main()
