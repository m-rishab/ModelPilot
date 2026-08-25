"""
ModelPilot — local configuration.

The NVIDIA NIM API key is loaded from a .env file or the NVIDIA_API_KEY
environment variable. The .env file is gitignored and never committed.
"""

import os
from pathlib import Path

# Load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
