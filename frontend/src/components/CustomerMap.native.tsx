import React from "react";
import { View } from "react-native";
import MapView, { Marker } from "react-native-maps";

import { makeStyles } from "@/src/theme";

export function CustomerMap({
  latitude,
  longitude,
  title,
}: {
  latitude: number;
  longitude: number;
  title: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.wrap} testID="customer-map">
      <MapView
        style={styles.map}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        pointerEvents="none"
      >
        <Marker coordinate={{ latitude, longitude }} title={title} />
      </MapView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: {
    flex: 1,
  },
}));
