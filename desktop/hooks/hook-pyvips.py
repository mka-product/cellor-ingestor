"""PyInstaller hook: collect pyvips and the bundled libvips shared library."""
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

binaries = collect_dynamic_libs("pyvips")
datas    = collect_data_files("pyvips")
