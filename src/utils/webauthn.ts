export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.PublicKeyCredential) &&
    Boolean(navigator.credentials?.create)
  );
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

export async function enrollDeviceBiometric(params: {
  userId: string;
  userName: string;
  phone: string;
}): Promise<{ credentialId: string; deviceLabel: string }> {
  if (!isWebAuthnSupported()) {
    throw new Error("Biometric passkeys are not supported in this browser context.");
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const userHandle = new TextEncoder().encode(params.userId);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "SmartPay Wallet India" },
      user: {
        id: userHandle,
        name: params.phone,
        displayName: params.userName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Biometric registration cancelled.");
  }

  const platformLabel = /Android/i.test(navigator.userAgent)
    ? "Android Biometric Key"
    : /Mac|iPhone|iPad/i.test(navigator.userAgent)
      ? "Apple Platform Biometrics"
      : "Device Platform Authenticator";

  return {
    credentialId: bufferToBase64Url(credential.rawId),
    deviceLabel: platformLabel,
  };
}

export async function verifyDeviceBiometric(credentialId?: string): Promise<boolean> {
  if (!isWebAuthnSupported()) {
    return false;
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialId
    ? [
        {
          type: "public-key",
          id: base64UrlToUint8Array(credentialId) as unknown as BufferSource,
        },
      ]
    : [];

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials,
      userVerification: "required",
      timeout: 60_000,
    },
  });

  return Boolean(assertion);
}
