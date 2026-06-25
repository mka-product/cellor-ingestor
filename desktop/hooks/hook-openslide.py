"""PyInstaller hook: collect the openslide native library."""
from PyInstaller.utils.hooks import collect_dynamic_libs

binaries = collect_dynamic_libs("openslide")
