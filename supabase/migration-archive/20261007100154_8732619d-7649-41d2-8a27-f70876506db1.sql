REVOKE ALL ON FUNCTION public.on_business_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_subscription_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_subscription_payment(uuid, text, text) TO authenticated;