import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


DRIVER = r'''
import inspect,json,os,runpy,sys
from unittest.mock import patch
real_umask=os.umask
def initialize(mask):
    namespace=inspect.currentframe().f_back.f_globals
    def probe(args):
        import backup
        calls=[]
        class Runtime:
            def command(self,args,**kwargs):
                calls.append(args)
                if len(calls)==1:
                    if sys.argv[2]=='other': raise ValueError('synthetic')
                    raise namespace['Refused']('SUBPROCESS_FAILED')
                return b'1' if 'psql' in args else b''
        identity=backup.Refused is namespace['Refused']
        try:
            with patch.object(backup.time,'sleep'):
                backup.wait_for_final_postgres(Runtime(),'synthetic-container',timeout=2)
            print(json.dumps({'sameException':identity,'recovered':True,'calls':len(calls)}))
        except Exception as error:
            print(json.dumps({'sameException':identity,'recovered':False,'calls':len(calls),'errorType':type(error).__name__}))
    namespace['main']=probe
    return real_umask(mask)
with patch.object(os,'umask',initialize):
    runpy.run_path(sys.argv[1],run_name='__main__')
'''


class EntryPointIdentityTests(unittest.TestCase):
    def run_cli(self, fixed=True, failure='refused'):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary)
            source=(Path(__file__).parent/'controller.py').read_text()
            if not fixed:
                source=source.replace("    sys.modules['controller'] = sys.modules[__name__]\n",'')
            (folder/'controller.py').write_text(source)
            shutil.copyfile(Path(__file__).parent/'backup.py',folder/'backup.py')
            (folder/'driver.py').write_text(DRIVER)
            result=subprocess.run([sys.executable,'-I',str(folder/'driver.py'),str(folder/'controller.py'),failure],
                                  capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            return json.loads(result.stdout)

    def test_original_cli_duplicates_refused_and_does_not_wait(self):
        result=self.run_cli(fixed=False)
        self.assertEqual(result,{'sameException':False,'recovered':False,'calls':1,'errorType':'Refused'})

    def test_real_main_entrypoint_shares_refused_and_waits_after_initial_failure(self):
        self.assertEqual(self.run_cli(),{'sameException':True,'recovered':True,'calls':3})

    def test_other_exceptions_are_not_retried(self):
        self.assertEqual(self.run_cli(failure='other'),
                         {'sameException':True,'recovered':False,'calls':1,'errorType':'ValueError'})


if __name__=='__main__':
    unittest.main()
