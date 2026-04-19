import sys
import os

# Add the evaluators/ directory to sys.path so test files can use bare imports
# (e.g. `from topk_evaluator import ...`) without the package prefix.
sys.path.insert(0, os.path.dirname(__file__))
# Add the runner root so test_run_evaluation.py can import run_evaluation
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
