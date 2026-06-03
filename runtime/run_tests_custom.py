import sys
import unittest

def run_all_tests():
    # Load all tests from the runtime/tests directory
    loader = unittest.TestLoader()
    suite = loader.discover('/mnt/kartik/ai_desktop_agent_assistant/opensarthi/runtime/tests')
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    if not result.wasSuccessful():
        sys.exit(1)

if __name__ == '__main__':
    run_all_tests()
