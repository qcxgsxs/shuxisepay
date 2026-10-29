CREATE TABLE public.account_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 kind text NOT NULL,
 title text NOT NULL,
 amount double precision NOT NULL,
 currency_code text NOT NULL,
 detail text NOT NULL DEFAULT '',
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.account_notifications TO service_role;
ALTER TABLE public.account_notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX account_notifications_owner_date ON public.account_notifications(account_id, created_at DESC);
CREATE FUNCTION public.capture_payment_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recipient uuid; sender uuid; cur uuid; amt double precision; code text; label text;
BEGIN
 IF NEW.action NOT IN ('give','deduct','pay','auto_charge','screen_transfer','qr_pay') THEN RETURN NEW; END IF;
 cur := NULLIF(NEW.detail->>'currency_id','')::uuid;
 amt := COALESCE((NEW.detail->>'amount')::double precision,(NEW.detail->>'total')::double precision,0);
 IF cur IS NULL OR amt <= 0 THEN RETURN NEW; END IF;
 SELECT c.code INTO code FROM public.currencies c WHERE c.id = cur;
 IF code IS NULL THEN RETURN NEW; END IF;
 sender := NEW.account_id;
 IF NEW.action = 'auto_charge' THEN
  recipient := NULLIF(NEW.detail->>'engineer_id','')::uuid;
  label := COALESCE(NEW.detail->>'facility','收费区域');
  INSERT INTO public.account_notifications(account_id,kind,title,amount,currency_code,detail) VALUES(sender,'etc','ETC扣款',amt,code,label || ' · ' || COALESCE(NEW.detail->>'reason','自动扣费') || CASE WHEN COALESCE((NEW.detail->>'debt')::double precision,0)>0 THEN '（余额不足，已扣成负数）' ELSE '' END);
 ELSIF NEW.action = 'deduct' THEN
  recipient := sender;
 ELSIF NEW.action = 'pay' THEN
  recipient := NULLIF(NEW.detail->>'seller_id','')::uuid;
  IF recipient IS NULL THEN SELECT id INTO recipient FROM public.accounts WHERE username=NEW.detail->>'to'; END IF;
 ELSIF NEW.action = 'qr_pay' THEN
  recipient := NULLIF(NEW.detail->>'to_id','')::uuid;
  INSERT INTO public.account_notifications(account_id,kind,title,amount,currency_code,detail) VALUES(sender,'payment','扫码付款',amt,code,'收款账号：' || COALESCE(NEW.detail->>'to',''));
 ELSE
  SELECT id INTO recipient FROM public.accounts WHERE username=NEW.detail->>'to';
 END IF;
 IF recipient IS NOT NULL THEN
  INSERT INTO public.account_notifications(account_id,kind,title,amount,currency_code,detail) VALUES(recipient,'receipt','收款到账',amt,code,CASE WHEN NEW.action='auto_charge' THEN label || ' · ETC收款' ELSE '付款账号：' || COALESCE(NEW.detail->>'from',NEW.username,'') END);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_payment_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_payment_notification() TO service_role;
CREATE TRIGGER payment_notification_after_log AFTER INSERT ON public.logs FOR EACH ROW EXECUTE FUNCTION public.capture_payment_notification();
CREATE FUNCTION public.pay_receipt(p_from uuid,p_to uuid,p_currency uuid,p_amount double precision,p_method uuid,p_fee double precision) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx uuid := gen_random_uuid(); b record; same_amount double precision; remaining numeric := p_amount; source_take numeric; worth numeric; rate_target double precision; portion numeric; current_to double precision; payer_name text; payee_name text;
BEGIN
 IF p_from=p_to THEN RAISE EXCEPTION '不能向自己付款'; END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_fee IS NULL OR p_fee<0 OR p_fee::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION '金额无效'; END IF;
 PERFORM 1 FROM public.accounts WHERE id IN (p_from,p_to) ORDER BY id FOR UPDATE;
 SELECT username INTO payer_name FROM public.accounts WHERE id=p_from AND NOT banned;
 SELECT username INTO payee_name FROM public.accounts WHERE id=p_to AND NOT banned;
 IF payer_name IS NULL OR payee_name IS NULL THEN RAISE EXCEPTION '付款或收款账号不可用'; END IF;
 SELECT rate_log10 INTO rate_target FROM public.currencies WHERE id=p_currency AND rate_sign>0;
 IF rate_target IS NULL THEN RAISE EXCEPTION '不支持此货币'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_methods WHERE id=p_method AND p_currency=ANY(currency_ids)) THEN RAISE EXCEPTION '该支付方式不支持此货币'; END IF;
 PERFORM 1 FROM public.balances WHERE account_id IN(p_from,p_to) ORDER BY account_id,currency_id FOR UPDATE;
 SELECT amount INTO same_amount FROM public.balances WHERE account_id=p_from AND currency_id=p_currency;
 portion := LEAST(GREATEST(COALESCE(same_amount,0),0),remaining);
 IF portion>0 THEN UPDATE public.balances SET amount=amount-portion::double precision WHERE account_id=p_from AND currency_id=p_currency; remaining := remaining-portion; END IF;
 FOR b IN SELECT bal.currency_id,bal.amount,c.rate_log10 FROM public.balances bal JOIN public.currencies c ON c.id=bal.currency_id WHERE bal.account_id=p_from AND bal.amount>0 AND c.rate_sign>0 AND c.id<>p_currency ORDER BY c.rate_log10 DESC LOOP
  EXIT WHEN remaining<=0;
  worth := b.amount::numeric * power(10::numeric, LEAST(616,GREATEST(-616,b.rate_log10-rate_target))::numeric) / (1+p_fee::numeric/100);
  portion := LEAST(worth,remaining);
  source_take := LEAST(b.amount::numeric,portion*(1+p_fee::numeric/100)*power(10::numeric,LEAST(616,GREATEST(-616,rate_target-b.rate_log10))::numeric));
  UPDATE public.balances SET amount=GREATEST(0,amount-source_take::double precision) WHERE account_id=p_from AND currency_id=b.currency_id;
  remaining := remaining-portion;
 END LOOP;
 IF remaining>p_amount::numeric*0.000000001 THEN RAISE EXCEPTION '余额不足'; END IF;
 SELECT amount INTO current_to FROM public.balances WHERE account_id=p_to AND currency_id=p_currency;
 IF COALESCE(current_to,0)::numeric+p_amount::numeric > 1.7976931348623157e308::numeric THEN RAISE EXCEPTION '收款金额超出上限'; END IF;
 INSERT INTO public.balances(account_id,currency_id,amount) VALUES(p_to,p_currency,COALESCE(current_to,0)+p_amount) ON CONFLICT(account_id,currency_id) DO UPDATE SET amount=EXCLUDED.amount;
 INSERT INTO public.logs(account_id,username,role,action,detail) SELECT id,username,role,'qr_pay',jsonb_build_object('to_id',p_to,'to',payee_name,'currency_id',p_currency,'amount',p_amount,'payment_method_id',p_method,'transaction_id',tx) FROM public.accounts WHERE id=p_from;
 RETURN tx;
END;
$$;
REVOKE ALL ON FUNCTION public.pay_receipt(uuid,uuid,uuid,double precision,uuid,double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_receipt(uuid,uuid,uuid,double precision,uuid,double precision) TO service_role;