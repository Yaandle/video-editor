# project_store.py

import json
from models import Project


class ProjectStore:
    @staticmethod
    def load(path):
        with open(path, "r", encoding="utf8") as f:
            return Project.from_dict(json.load(f))

    @staticmethod
    def save(project, path):
        with open(path, "w", encoding="utf8") as f:
            json.dump(project.to_dict(), f, indent=2)