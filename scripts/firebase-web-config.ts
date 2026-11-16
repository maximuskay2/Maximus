export interface FirebaseWebBuildConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  vapidKey?: string;
}

const FIREBASE_WEB = {
  apiKey: "AIzaSyDoYxmrw-rKZ-oLcR_Y0l1CvfmnVZyBYkU",
  authDomain: "maximusbot-e2702.firebaseapp.com",
  projectId: "maximusbot-e2702",
  storageBucket: "maximusbot-e2702.firebasestorage.app",
  messagingSenderId: "78173460265",
  appId: "1:78173460265:web:de42047fe6f4a810444938",
  measurementId: "G-ZTZLM92BGP",
  vapidKey: "BGWRPS6FOxhqhZsmSulDh2lFlZKI8sVDvs03qrIrQYolU7qbvWqT18aBQESAzl35-ohyYsg4hz7qi1EIbeUSvTo",
} as const;

export function firebaseWebConfig(
  env: NodeJS.ProcessEnv = process.env,
): FirebaseWebBuildConfig {
  const vapidKey = typeof env.VITE_FIREBASE_VAPID_KEY === "string" && env.VITE_FIREBASE_VAPID_KEY.trim()
    ? env.VITE_FIREBASE_VAPID_KEY.trim()
    : FIREBASE_WEB.vapidKey;
  const appId = typeof env.VITE_FIREBASE_APP_ID === "string" && env.VITE_FIREBASE_APP_ID.trim()
    ? env.VITE_FIREBASE_APP_ID.trim()
    : FIREBASE_WEB.appId;
  return {
    ...FIREBASE_WEB,
    appId,
    vapidKey,
  };
}
