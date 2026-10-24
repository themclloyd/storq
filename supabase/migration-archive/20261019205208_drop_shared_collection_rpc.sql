-- Retire the public collection-sharing surface: the unauthenticated /c/:slug
-- storefront and its RPC are dropped to eliminate that attack surface.
DROP FUNCTION IF EXISTS public.get_shared_collection(text);
DROP FUNCTION IF EXISTS app.get_shared_collection(text);

NOTIFY pgrst, 'reload schema';
