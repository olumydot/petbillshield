"""Route-order regression tests."""

from app.main import app


def test_compare_ask_route_precedes_dynamic_estimate_ask_route():
    paths = [route.path for route in app.routes if "POST" in getattr(route, "methods", set())]

    compare_ask_index = paths.index("/api/estimates/compare/ask")
    estimate_ask_index = paths.index("/api/estimates/{analysis_id}/ask")

    assert compare_ask_index < estimate_ask_index
