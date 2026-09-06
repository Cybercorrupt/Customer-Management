import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { AuthProvider } from "@/src/auth/AuthContext";
import { SettingsProvider } from "@/src/settings/SettingsContext";
import { AppConfigProvider } from "@/src/config/AppConfigContext";
import { queryClient } from "@/src/query-client";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <SettingsProvider>
                <AppConfigProvider>
                  <StatusBar style="light" />
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="login" />
                    <Stack.Screen name="admin-login" />
                    <Stack.Screen name="(app)" />
                    <Stack.Screen name="admin" />
                    <Stack.Screen name="search" options={{ animation: "fade" }} />
                    <Stack.Screen name="customer/[id]" />
                    <Stack.Screen name="admin-customer-form" />
                    <Stack.Screen name="admin-user-form" />
                    <Stack.Screen name="admin-change-password" />
                    <Stack.Screen name="admin-about-edit" />
                    <Stack.Screen name="edit-profile" />
                    <Stack.Screen name="change-password" />
                  </Stack>
                </AppConfigProvider>
              </SettingsProvider>
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
