from app.api.auth import router


def test_auth_router_exposes_google_but_not_password_endpoints():
    routes = {
        (method, route.path)
        for route in router.routes
        for method in getattr(route, "methods", set())
    }

    assert ("POST", "/auth/google") in routes
    assert ("GET", "/auth/google/client-id") in routes
    assert ("POST", "/auth/login") not in routes
    assert ("POST", "/auth/register") not in routes
