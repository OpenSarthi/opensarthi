import sys
import os
import unittest

def run_all_tests():
    # Enable testing environment before loading tests or importing DB
    os.environ["OPENSARTHI_TESTING"] = "1"
    
    runtime_dir = os.path.dirname(os.path.abspath(__file__))
    test_db = os.path.join(runtime_dir, "opensarthi_test.db")
    
    # Clean up test DB from previous crashed run
    if os.path.exists(test_db):
        try:
            os.remove(test_db)
        except Exception:
            pass

    # Load all tests from the runtime/tests directory
    loader = unittest.TestLoader()
    suite = loader.discover(os.path.join(runtime_dir, 'tests'))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Clean up test DB after test run completed
    if os.path.exists(test_db):
        try:
            os.remove(test_db)
        except Exception:
            pass
            
    if not result.wasSuccessful():
        sys.exit(1)

if __name__ == '__main__':
    run_all_tests()
