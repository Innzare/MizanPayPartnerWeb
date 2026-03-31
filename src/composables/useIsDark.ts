import { useTheme } from 'vuetify'

export function useIsDark() {
  const theme = useTheme()
  const isDark = computed(() => theme.current.value.dark)

  function statusStyle(config: { bgLight: string; bgDark: string; color: string } | undefined) {
    if (!config) return {}
    return { background: isDark.value ? config.bgDark : config.bgLight, color: config.color }
  }

  return { isDark, statusStyle }
}