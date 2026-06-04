from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PET_ROUTES = BACKEND_ROOT / "app" / "routes" / "pet_routes.py"


def _route_block(source: str, marker: str) -> str:
    start = source.index(marker)
    next_route = source.find("\n@router.", start + len(marker))
    return source[start:] if next_route == -1 else source[start:next_route]


def test_basic_pet_profile_routes_do_not_require_paid_plan():
    source = PET_ROUTES.read_text()

    for marker in (
        '@router.get("/pets/{pet_id}")',
        '@router.put("/pets/{pet_id}"',
        '@router.delete("/pets/{pet_id}")',
    ):
        block = _route_block(source, marker)
        assert "require_paid_plan(user)" not in block


def test_delete_pet_removes_active_pet_slot():
    source = PET_ROUTES.read_text()
    delete_block = _route_block(source, '@router.delete("/pets/{pet_id}")')
    assert '"$pull": {"active_pet_ids": pet_id}' in delete_block
