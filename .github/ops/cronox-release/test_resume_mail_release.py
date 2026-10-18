import json
import os
import shutil
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import controller
import resume_mail_release as resume

class ForwardTests(unittest.TestCase):
 @unittest.skipUnless(os.name == 'posix' and Path('/usr/bin/npm').is_file() and shutil.which('node'), 'Linux npm fixture')
 def test_real_npm_production_include_without_network_or_lock_changes(self):
  result=subprocess.run(['node',str(Path(__file__).with_name('test_build_dependencies.cjs'))],capture_output=True,text=True,timeout=60)
  self.assertEqual(result.returncode,0,'Isolated npm fixture failed; inspect private test output')
  self.assertEqual(json.loads(result.stdout),{'productionDefaultOmittedBuildTool':True,'explicitIncludeInstalledBuildTool':True,'lockUnchanged':True,'networkUsed':False})

 def test_exact_controller_patch_and_unknown_base(self):
  original=b'class Fixture:\n    def command(self):\n'+resume.ANCHOR+b'            pass\n'
  expected=original.replace(resume.ANCHOR,resume.EXTRA+resume.ANCHOR,1)
  with mock.patch.object(resume,'CONTROLLER',resume.digest(original)),mock.patch.object(resume,'PATCH_CONTROLLER',resume.digest(expected)):
   self.assertEqual(resume.transform(original),expected)
   with self.assertRaises(ValueError): resume.transform(expected)
   with self.assertRaises(ValueError): resume.transform(original+b'# unknown\n')

 def test_actual_command_strips_only_ipc_and_node_exits_normally(self):
  with tempfile.TemporaryDirectory() as d:
   rt=object.__new__(controller.Runtime);rt.folder=Path(d)
   env={'NODE_CHANNEL_FD':'3','NODE_CHANNEL_SERIALIZATION_MODE':'json','NODE_UNIQUE_ID':'fixture','NODE_ENV':'production','EMAIL_ENABLED':'false','BUSINESS_SETTING':'preserve'}
   script="process.stdout.write(JSON.stringify({ipcPresent:['NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID'].some(k=>Object.hasOwn(process.env,k)),business:process.env.BUSINESS_SETTING,nodeEnv:process.env.NODE_ENV,email:process.env.EMAIL_ENABLED}))"
   result=rt.command(['node','-e',script],env=env)
   self.assertEqual(json.loads(result),{'ipcPresent':False,'business':'preserve','nodeEnv':'production','email':'false'})
   self.assertEqual(env['NODE_CHANNEL_FD'],'3')

 def exercise(self, fail=None, interrupt=False, hold_fail=False):
  calls=[]
  class Fake:
   def __getattr__(self,name):
    def run():
     calls.append(name)
     if name==fail: raise KeyboardInterrupt() if interrupt else RuntimeError('simulated')
     if name=='hold' and hold_fail: raise RuntimeError('simulated hold failure')
    return run
  with tempfile.TemporaryDirectory() as d, mock.patch.object(resume,'FOLDER',Path(d)):
   state={'revision':resume.SHA,'status':'held','phase':'install','phaseComplete':False,'failureCode':'PHASE_FAILED'}
   if fail:
    with self.assertRaises(BaseException): resume.continue_release(controller,Fake(),state)
   else: resume.continue_release(controller,Fake(),state)
   result=json.loads((Path(d)/'status.json').read_text())
  return calls,result

 def test_success_starts_at_install_and_preserves_every_remaining_check(self):
  calls,s=self.exercise()
  self.assertEqual(calls,list(controller.PHASES[4:]))
  self.assertEqual(s['status'],'success'); self.assertNotIn('failureCode',s)

 def test_failure_at_every_phase_holds_without_rollback_or_later_steps(self):
  for phase in controller.PHASES[4:]:
   with self.subTest(phase=phase):
    calls,s=self.exercise(phase)
    self.assertEqual(calls[-1],'hold'); self.assertEqual(calls[-2],phase)
    self.assertEqual(s['status'],'held'); self.assertTrue(s['safeStateConfirmed'])
    self.assertFalse(s['automaticRollback']); self.assertEqual(s['phase'],phase)

 def test_interrupt_holds_and_preserves_exact_phase(self):
  calls,s=self.exercise('migrate',interrupt=True)
  self.assertEqual(calls,['install','migrate','hold']); self.assertEqual(s['phase'],'migrate')

 def test_failed_hold_never_claims_safe_state(self):
  calls,s=self.exercise('activate',hold_fail=True)
  self.assertFalse(s['safeStateConfirmed']); self.assertEqual(s['status'],'held')

 def test_repeat_refused_before_any_operation(self):
  with tempfile.TemporaryDirectory() as d, mock.patch.object(resume,'BACKUP',Path(d)):
   rt=mock.Mock()
   with self.assertRaisesRegex(controller.Refused,'ALREADY_ATTEMPTED'): resume.validate(controller,rt)
   self.assertEqual(rt.mock_calls,[])

 def test_foreign_phase_and_state_refused_before_probing(self):
  for changes in ({'phase':'migrate'},{'status':'running'},{'phaseComplete':True}):
   with tempfile.TemporaryDirectory() as d:
    p=Path(d); s={'revision':resume.SHA,'status':'held','phase':'install','phaseComplete':False,'safeStateConfirmed':True}; s.update(changes)
    (p/'status.json').write_text(json.dumps(s))
    with mock.patch.object(resume,'FOLDER',p),mock.patch.object(resume,'BACKUP',p/'no-marker'):
     rt=mock.Mock()
     with self.assertRaisesRegex(controller.Refused,'UNEXPECTED_RELEASE_STATE'): resume.validate(controller,rt)
     self.assertEqual(rt.mock_calls,[])

if __name__=='__main__': unittest.main()
