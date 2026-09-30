import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PieChart } from "react-native-gifted-charts";
import { CaretDown, CaretUp } from "phosphor-react-native";

import { Slice } from "@/src/api/client";
import { useSettings } from "@/src/settings/SettingsContext";
import { makeStyles, useTheme } from "@/src/theme";

// Max legend rows shown before the "show more" toggle appears.
const LEGEND_LIMIT = 5;

// A palette used for slices that are not the semantic status colors.
function usePalette() {  const { colors } = useTheme();
  return [
    colors.brandPrimary,
    colors.brandSecondary,
    colors.info,
    colors.success,
    "#8B5CF6",
    colors.muted,
  ];
}

function statusPalette(label: string, colors: any): string | null {
  if (label === "Active") return colors.success;
  if (label === "Inactive") return colors.muted;
  if (label === "Bad Debt") return colors.error;
  return null;
}

export function DonutCard({
  title,
  slices,
  useStatusColors = false,
  testID,
}: {
  title: string;
  slices: Slice[];
  useStatusColors?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useSettings();
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);

  const total = useMemo(() => slices.reduce((s, x) => s + x.count, 0), [slices]);

  const colored = useMemo(
    () =>
      slices.map((s, i) => ({
        ...s,
        color:
          (useStatusColors && statusPalette(s.label, colors)) ||
          palette[i % palette.length],
      })),
    [slices, useStatusColors, palette, colors],
  );

  const pieData = colored
    .filter((s) => s.count > 0)
    .map((s) => ({ value: s.count, color: s.color }));

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.chartWrap}>
        {total > 0 ? (
          <PieChart
            data={pieData}
            donut
            radius={82}
            innerRadius={52}
            innerCircleColor={colors.surfaceSecondary}
            centerLabelComponent={() => (
              <View style={styles.centerLabel}>
                <Text style={styles.centerValue}>{total}</Text>
                <Text style={styles.centerCaption}>Customer</Text>
              </View>
            )}
          />
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyText}>Belum ada data</Text>
          </View>
        )}
      </View>

      <View style={styles.legend}>
        {(expanded ? colored : colored.slice(0, LEGEND_LIMIT)).map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          return (
            <View key={s.label} style={styles.legendRow} testID={`legend-${title}-${s.label}`}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <View style={styles.legendTextWrap}>
                <Text style={styles.legendLabel}>{s.label}</Text>
                <Text style={styles.legendMeta}>
                  {s.count} Customer • {pct.toFixed(1)}%
                </Text>
              </View>
            </View>
          );
        })}

        {colored.length > LEGEND_LIMIT ? (
          <Pressable
            style={({ pressed }) => [styles.moreBtn, pressed && styles.moreBtnPressed]}
            onPress={() => setExpanded((v) => !v)}
            testID={`legend-more-${title}`}
          >
            <Text style={styles.moreText}>
              {expanded
                ? t("chart.showLess")
                : t("chart.showMore").replace("{n}", String(colored.length - LEGEND_LIMIT))}
            </Text>
            {expanded ? (
              <CaretUp size={14} color={colors.brandPrimary} weight="bold" />
            ) : (
              <CaretDown size={14} color={colors.brandPrimary} weight="bold" />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  title: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  chartWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerLabel: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerValue: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "800",
  },
  centerCaption: {
    color: colors.muted,
    fontSize: 11,
  },
  emptyChart: {
    height: 164,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
  },
  legend: {
    marginTop: 16,
    gap: 12,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
  },
  legendTextWrap: {
    flex: 1,
  },
  legendLabel: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "600",
  },
  legendMeta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 1,
  },
  moreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moreBtnPressed: {
    backgroundColor: colors.surfaceTertiary,
  },
  moreText: {
    color: colors.brandPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
}));
