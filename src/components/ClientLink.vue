<script setup lang="ts">
/**
 * Имя клиента в списках: ссылка прямо в его профиль, минуя карточку сделки.
 *
 * Это именно `router-link`, а не `@click` с `router.push`: настоящий `<a href>`
 * умеет то, чего клик-обработчик не умеет — средний клик, Cmd/Ctrl+клик и
 * «Открыть в новой вкладке» из контекстного меню. Клик гасится
 * (`@click.stop`), иначе сработал бы ещё и обработчик строки таблицы.
 *
 * Обычным текстом имя остаётся в двух случаях: у клиента нет профиля (сделка
 * пришла импортом, где было только имя) и у сотрудника нет права смотреть
 * данные клиентов — «мёртвая» ссылка, ведущая на отказ, хуже её отсутствия.
 * В режиме массового выбора ссылка тоже отключается: уход со страницы посреди
 * выделения строк потерял бы выбор.
 */
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  /** Профиль клиента. Пусто — имя останется текстом. */
  profileId?: string | null
  /** Отображаемое имя. */
  name?: string | null
  /** Отключить ссылку (например, на время массового выбора). */
  disabled?: boolean
}>()

const auth = useAuthStore()

const linked = computed(() => !!props.profileId && !props.disabled && auth.can('clients.view'))
</script>

<template>
  <router-link
    v-if="linked"
    :to="`/clients/${profileId}`"
    class="client-link"
    title="Открыть профиль клиента"
    @click.stop
  >
    <slot>{{ name }}</slot>
  </router-link>
  <span v-else class="client-link client-link--plain">
    <slot>{{ name }}</slot>
  </span>
</template>

<style scoped>
/* Кликабельное имя выделено фирменным зелёным и пунктирным подчёркиванием:
   в плотной таблице сразу видно, что по имени можно перейти, но строка при
   этом не превращается в россыпь ярких ссылок. На наведении подчёркивание
   становится сплошным — привычное поведение ссылки.

   На цветной подложке (зелёные шапки карточек и модалок) зелёный сливается с
   фоном. Такой блок задаёт `--client-link-color: #fff` у себя — и ссылка
   становится белой, сохраняя подчёркивание. */
.client-link {
  color: var(--client-link-color, rgb(var(--v-theme-primary)));
  font-weight: 500;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--client-link-underline, rgba(var(--v-theme-primary), 0.5));
  text-underline-offset: 3px;
  transition: text-decoration-color 0.15s, opacity 0.15s;
}
.client-link:hover {
  text-decoration-style: solid;
  text-decoration-color: currentColor;
  opacity: 0.85;
}
/* Без профиля — обычный текст, никаких намёков на кликабельность. */
.client-link--plain {
  color: inherit;
  font-weight: inherit;
  text-decoration: none;
  cursor: inherit;
}
.client-link--plain:hover {
  color: inherit;
  opacity: 1;
}
</style>
