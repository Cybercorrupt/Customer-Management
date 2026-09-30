import { useRouter } from "expo-router";

import { AboutContent } from "@/src/components/AboutContent";

export default function AboutScreen() {
  const router = useRouter();
  return <AboutContent onUnlock={() => router.push("/admin-login")} />;
}
