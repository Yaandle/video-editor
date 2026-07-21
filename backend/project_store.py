# project_store.py

import json
import os
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

    @staticmethod
    def delete(path):
        try:
            if not os.path.exists(path):
                return False, "Project not found"

            os.remove(path)
            return True, "Deleted"

        except PermissionError:
            return False, "Permission denied"

        except Exception as exc:
            return False, str(exc)