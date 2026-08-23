"""
ModelPilot — local configuration.

The NVIDIA NIM API key lives here so the web UI never asks for it.
Override it per environment with the NVIDIA_API_KEY environment variable
without touching this file.
"""

import os

NVIDIA_API_KEY = os.getenv(
    "NVIDIA_API_KEY",
    "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",
)
