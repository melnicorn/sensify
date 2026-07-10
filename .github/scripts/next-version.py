#!/usr/bin/env python3
import json
import subprocess
import re
from pathlib import Path


def get_pinned_version():
    with open(Path(__file__).parent.parent.parent / "package.json") as f:
        version = json.load(f)["version"]
    major, minor, _ = version.strip().split(".")
    return int(major), int(minor)


def get_existing_tags():
    try:
        output = subprocess.check_output(["git", "tag"], text=True)
        return [t for t in output.strip().split("\n") if t]
    except subprocess.CalledProcessError:
        return []


def get_matching_patch_versions(major, minor, tags):
    pattern = re.compile(rf"^v?{major}\.{minor}\.(\d+)$")
    patch_versions = []
    for tag in tags:
        match = pattern.match(tag)
        if match:
            patch_versions.append(int(match.group(1)))
    return patch_versions


def main():
    major, minor = get_pinned_version()
    tags = get_existing_tags()
    patch_versions = get_matching_patch_versions(major, minor, tags)
    next_patch = max(patch_versions, default=0) + 1
    print(f"{major}.{minor}.{next_patch}")


if __name__ == "__main__":
    main()
