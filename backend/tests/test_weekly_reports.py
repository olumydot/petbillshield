from pathlib import Path


def test_weekly_reports_pref_is_added_to_backend_defaults():
    src = Path("backend/app/routes/user_routes.py").read_text()
    assert '"weekly_reports":  True' in src or '"weekly_reports": True' in src
    assert "weekly_reports:  Optional[bool] = None" in src or "weekly_reports: Optional[bool] = None" in src


def test_weekly_reports_pref_is_exposed_in_profile_settings():
    src = Path("frontend/src/pages/ProfileSettings.jsx").read_text()
    assert 'key:   "weekly_reports"' in src or 'key: "weekly_reports"' in src
    assert "Weekly AI account report" in src


def test_main_scheduler_contains_sunday_8pm_weekly_job():
    src = Path("backend/app/main.py").read_text()
    assert 'id="weekly_account_reports_enqueue"' in src
    assert 'id="weekly_account_reports_prepare"' in src
    assert 'id="weekly_account_reports_send"' in src
    assert 'day_of_week="sun"' in src
    assert 'hour="12-19"' in src
    assert 'hour="20-23"' in src
    assert 'timezone="America/Chicago"' in src


def test_weekly_reports_module_contains_admin_dispatch_and_paid_guard():
    src = Path("backend/app/routes/weekly_report_routes.py").read_text()
    assert '/admin/weekly-reports/dispatch-now' in src
    assert "immediate: bool = Query(default=False)" in src
    assert 'def _user_is_paid(' in src
    assert 'def _weekly_reports_enabled(' in src
    assert 'def _build_weekly_report_email_html(' in src
    assert 'WEEKLY_REPORT_SYSTEM_PROMPT' in src


def test_weekly_reports_module_prevents_duplicate_same_week_sends():
    src = Path("backend/app/routes/weekly_report_routes.py").read_text()
    assert '{"user_id": user_id, "week_key": week_key}' in src
    assert 'reason": "already_sent"' in src or "reason': 'already_sent'" in src


def test_weekly_reports_module_uses_batched_queue_pipeline():
    src = Path("backend/app/routes/weekly_report_routes.py").read_text()
    assert 'WEEKLY_REPORT_PREP_BATCH_SIZE' in src
    assert 'WEEKLY_REPORT_SEND_BATCH_SIZE' in src
    assert 'def _should_generate_with_ai(' in src
    assert 'async def enqueue_weekly_account_reports(' in src
    assert 'async def prepare_weekly_account_report_batch(' in src
    assert 'async def send_due_weekly_account_reports(' in src
