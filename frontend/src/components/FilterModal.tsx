import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "phosphor-react-native";

import { makeStyles, useTheme } from "@/src/theme";

export function FilterModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} testID="filter-modal-overlay">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {options.map((opt) => {
              const active = opt === selected;
              return (
                <Pressable
                  key={opt}
                  style={styles.row}
                  onPress={() => {
                    onSelect(opt);
                    onClose();
                  }}
                  testID={`filter-option-${opt}`}
                >
                  <Text style={[styles.rowText, active && styles.rowTextActive]}>{opt}</Text>
                  {active ? <Check size={18} color={colors.brandPrimary} weight="bold" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  title: {
    color: colors.onSurface,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 8,
  },
  list: {
    maxHeight: 360,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowText: {
    color: colors.onSurfaceSecondary,
    fontSize: 15,
  },
  rowTextActive: {
    color: colors.brandPrimary,
    fontWeight: "700",
  },
}));
