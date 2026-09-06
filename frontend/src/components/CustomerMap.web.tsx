import React from "react";
import { Text, View } from "react-native";
import { MapPin } from "phosphor-react-native";

import { makeStyles, useTheme } from "@/src/theme";

// react-native-maps is native only; on web we show a lightweight placeholder.
export function CustomerMap({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
  title: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} testID="customer-map">
      <MapPin size={36} color={colors.brandPrimary} weight="fill" />
      <Text style={styles.text}>Peta tersedia di aplikasi Android</Text>
      <Text style={styles.coords}>
        {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    height: 200,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  text: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    fontWeight: "600",
  },
  coords: {
    color: colors.muted,
    fontSize: 13,
  },
}));
