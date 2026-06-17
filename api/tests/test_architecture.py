from pathlib import Path


def test_domain_layer_has_no_fastapi_imports() -> None:
  for path in Path("api/api_service/domain").glob("*.py"):
      content = path.read_text()
      assert "fastapi" not in content


def test_interfaces_do_not_import_repositories_directly() -> None:
  for path in Path("api/api_service/interfaces").rglob("*.py"):
      content = path.read_text()
      assert "infrastructure.repositories" not in content
