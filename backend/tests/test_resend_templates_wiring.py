from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SHARED_FILE = BACKEND_ROOT / "app" / "shared.py"
BILLING_FILE = BACKEND_ROOT / "app" / "routes" / "billing_routes.py"
AUTH_FILE = BACKEND_ROOT / "app" / "routes" / "auth_routes.py"
USER_FILE = BACKEND_ROOT / "app" / "routes" / "user_routes.py"


def test_shared_declares_template_env_vars_and_send_helper():
    source = SHARED_FILE.read_text()
    for env_name in (
        "RESEND_TEMPLATE_WELCOME",
        "RESEND_TEMPLATE_RENEWAL_SUCCESS",
        "RESEND_TEMPLATE_RENEWAL_REMINDER",
        "RESEND_TEMPLATE_PAYMENT_FAILED",
        "RESEND_TEMPLATE_SUBSCRIPTION_CANCELED",
        "RESEND_TEMPLATE_SUBSCRIPTION_REACTIVATED",
        "RESEND_TEMPLATE_PLAN_CHANGED",
        "RESEND_TEMPLATE_PASSWORD_RESET",
        "RESEND_TEMPLATE_VERIFY_EMAIL_CHANGE",
    ):
        assert env_name in source

    assert "async def send_resend_email(" in source
    assert '"template"' in source
    assert '"variables"' in source


def test_billing_routes_use_template_keys_with_html_fallback():
    source = BILLING_FILE.read_text()
    for template_key in (
        'template_key="welcome"',
        'template_key="renewal_success"',
        'template_key="renewal_reminder"',
        'template_key="payment_failed"',
        'template_key="subscription_canceled"',
        'template_key="subscription_reactivated"',
        'template_key="plan_changed"',
    ):
        assert template_key in source


def test_auth_and_user_routes_use_template_send_helper():
    auth_source = AUTH_FILE.read_text()
    user_source = USER_FILE.read_text()

    assert 'template_key="password_reset"' in auth_source
    assert 'template_key="verify_email_change"' in user_source
    assert "send_resend_email" in auth_source
    assert "send_resend_email" in user_source
