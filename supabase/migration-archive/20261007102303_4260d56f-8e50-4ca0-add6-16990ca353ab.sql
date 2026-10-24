ALTER FUNCTION app.set_ctx(text, uuid, text) SET search_path = public;
REVOKE ALL ON FUNCTION app.set_ctx(text, uuid, text) FROM authenticated;