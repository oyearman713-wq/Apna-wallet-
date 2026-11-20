import crypto from "crypto";

export interface SmsDispatchResult {
  provider: "twilio" | "sandbox";
  providerMessageId: string;
  delivered: boolean;
  sandboxOtpPreview?: string;
  notice: string;
}

export async function dispatchOtpSms(phone: string, otp: string): Promise<SmsDispatchResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const mode = (process.env.SMS_PROVIDER || "sandbox").toLowerCase();

  if (sid && token && from) {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const body = new URLSearchParams({
      To: phone,
      From: from,
      Body: `Your SmartPay Wallet verification code is ${otp}. Valid for 5 minutes. Never share this OTP or your UPI PIN with anyone.`,
    });

    const authHeader = Buffer.from(`${sid}:${token}`).toString("base64");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const json = (await response.json()) as { sid?: string; message?: string };
    if (!response.ok || !json.sid) {
      throw new Error(json.message || `SMS gateway returned HTTP ${response.status}`);
    }

    return {
      provider: "twilio",
      providerMessageId: json.sid,
      delivered: true,
      notice: `OTP dispatched via Twilio SMS to ${phone}`,
    };
  }

  if (mode === "live") {
    throw new Error(
      "SMS_PROVIDER is set to live, but Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER) are missing."
    );
  }

  // Official sandbox SMS provider when carrier keys are not configured
  const msgId = `sbx_sms_${crypto.randomBytes(6).toString("hex")}`;
  return {
    provider: "sandbox",
    providerMessageId: msgId,
    delivered: true,
    sandboxOtpPreview: otp,
    notice:
      "Sandbox SMS mode active (configure TWILIO_* environment variables for live carrier SMS).",
  };
}
