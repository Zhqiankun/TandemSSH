"""Build a NoCloud configuration disc from the launcher's private run data."""
import io
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    config = json.load(source)
sys.path.insert(0, config["pythonDependencies"])
import pycdlib

iso = pycdlib.PyCdlib()
iso.new(interchange_level=3, joliet=3, rock_ridge="1.09", vol_ident="CIDATA")
identifiers = {
    "user-data": "USER_DAT.;1",
    "meta-data": "META_DAT.;1",
    "network-config": "NETWORK.;1",
}
try:
    for name, content in config["files"].items():
        data = content.encode("utf-8")
        iso.add_fp(
            io.BytesIO(data),
            len(data),
            iso_path="/" + identifiers[name],
            rr_name=name,
            joliet_path="/" + name,
        )
    iso.write(config["output"])
finally:
    iso.close()
