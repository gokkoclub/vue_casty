<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'

/**
 * 香盤の編集。いまの香盤スプレッドシートと同じ並びで直せるようにする。
 *
 *   順番 / S# / 柱 / L/S / D/N / 時間 / 現場 / 備考 / 配役×キャスト
 *
 * 触るのは payload だけ。保存すると版が1つ積まれる。
 * 時刻（t0/t1）はここでは触らない。組み立てのときに全部計算し直されるので、
 * 効くのは「尺」と「並び順」だけ（shoot-json.md）。
 */

const props = defineProps<{ payload: Record<string, any> }>()
const emit = defineEmits<{ (e: 'update', v: Record<string, any>): void }>()

// 編集用の複製。元は触らない
const draft = ref<Record<string, any>>(structuredClone(props.payload))
watch(() => props.payload, v => { draft.value = structuredClone(v) })

function touch() {
  emit('update', structuredClone(draft.value))
}

interface Row { kind: 'sc' | 'brk' | 'banner'; [k: string]: any }
interface CastRow { role: string; short?: string; short2?: string; name?: string }

const rows = computed<Row[]>(() => draft.value.rows ?? [])
const cast = computed<CastRow[]>(() => draft.value.cast ?? [])

const DN = [
  { label: 'M（朝）', value: 'M' },
  { label: 'D（昼）', value: 'D' },
  { label: 'E（夕）', value: 'E' },
  { label: 'N（夜）', value: 'N' }
]

const places = computed(() =>
  Object.entries(draft.value.locations ?? {}).map(([id, v]: [string, any]) => ({
    label: v?.short || v?.name || id,
    value: id
  }))
)

const KIND: Record<string, { label: string; severity: string }> = {
  sc: { label: 'シーン', severity: 'info' },
  brk: { label: '準備・移動', severity: 'secondary' },
  banner: { label: '見出し', severity: 'contrast' }
}

function move(i: number, d: number) {
  const to = i + d
  if (to < 0 || to >= rows.value.length) return
  const r = draft.value.rows
  ;[r[i], r[to]] = [r[to], r[i]]
  touch()
}

function remove(i: number) {
  draft.value.rows.splice(i, 1)
  touch()
}

function add(kind: 'sc' | 'brk' | 'banner', at: number) {
  const base: Record<string, any> =
    kind === 'sc'
      ? { kind: 'sc', sc: '', pillar: '', dn: 'D', dur: '0:20', place: '', note: '',
          cast: cast.value.map(() => 0) }
      : kind === 'brk'
        ? { kind: 'brk', label: '準備', dur: '0:10' }
        : { kind: 'banner', label: '' }
  draft.value.rows.splice(at + 1, 0, base)
  touch()
}

/** そのシーンにその役が出るか。rows[].cast は cast[] と同じ並びの 0/1 */
function inScene(row: Row, i: number) {
  return (row.cast?.[i] ?? 0) === 1
}
function toggle(row: Row, i: number, on: boolean) {
  if (!Array.isArray(row.cast)) row.cast = cast.value.map(() => 0)
  while (row.cast.length < cast.value.length) row.cast.push(0)
  row.cast[i] = on ? 1 : 0
  touch()
}

const sceneCount = computed(() => rows.value.filter((r: any) => r.kind === 'sc').length)
</script>

<template>
  <div class="editor">
    <!-- ① 基本情報。スプレッドシートの「色付きセル」にあたる -->
    <section class="block">
      <h3>基本情報</h3>
      <div class="fields">
        <label>
          <span>タイトル</span>
          <InputText v-model="draft.head.title" @change="touch" />
        </label>
        <label>
          <span>撮影日</span>
          <InputText v-model="draft.head.date" placeholder="2026.06.23" @change="touch" />
        </label>
        <label>
          <span>雨天時</span>
          <InputText v-model="draft.head.rain" placeholder="雨天決行" @change="touch" />
        </label>
        <label>
          <span>想定テイク数</span>
          <InputText v-model.number="draft.head.takes" @change="touch" />
        </label>
        <label>
          <span>ヘアメイクの人数</span>
          <InputText v-model.number="draft.head.hairCrew" @change="touch" />
        </label>
        <label class="check">
          <Checkbox v-model="draft.head.fixed" :binary="true" inputId="fixed" @change="touch" />
          <span>決定香盤にする</span>
        </label>
      </div>
      <p class="hint">
        入り時間・出る時間はここでは触りません。<strong>尺と並び順</strong>から全部計算し直されます。
      </p>
    </section>

    <!-- ② 進行表。スプレッドシートの 順番/S#/柱/L/S/D/N/時間/現場/備考 と同じ並び -->
    <section class="block">
      <h3>
        進行表
        <Tag :value="`${rows.length}行 / シーン${sceneCount}本`" severity="secondary" />
      </h3>

      <div class="grid-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="w-ord">順番</th>
              <th class="w-kind">種別</th>
              <th class="w-sc">S#</th>
              <th class="w-pillar">柱</th>
              <th class="w-dn">D/N</th>
              <th class="w-dur">時間</th>
              <th class="w-place">現場</th>
              <th class="w-note">備考（衣装・小道具・美術 等）</th>
              <th v-for="(c, ci) in cast" :key="ci" class="w-cast" :title="c.name">
                <span class="role">{{ c.short2 || c.role }}</span>
                <span class="who">{{ c.short }}</span>
              </th>
              <th class="w-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i" :class="r.kind">
              <td class="w-ord num">{{ Number(i) + 1 }}</td>
              <td class="w-kind">
                <Tag :value="KIND[r.kind]?.label ?? r.kind" :severity="KIND[r.kind]?.severity" />
              </td>

              <template v-if="r.kind === 'sc'">
                <td><InputText v-model="r.sc" @change="touch" placeholder="＃1" /></td>
                <td><InputText v-model="r.pillar" @change="touch" placeholder="家リビング" /></td>
                <td>
                  <Select v-model="r.dn" :options="DN" optionLabel="label" optionValue="value"
                          @change="touch" />
                </td>
                <td><InputText v-model="r.dur" @change="touch" placeholder="0:20" class="num" /></td>
                <td>
                  <Select v-model="r.place" :options="places" optionLabel="label" optionValue="value"
                          showClear @change="touch" />
                </td>
                <td><Textarea v-model="r.note" @change="touch" rows="1" autoResize /></td>
                <td v-for="(_c, ci) in cast" :key="ci" class="w-cast center">
                  <Checkbox :modelValue="inScene(r, Number(ci))" :binary="true"
                            @update:modelValue="v => toggle(r, Number(ci), !!v)" />
                </td>
              </template>

              <template v-else>
                <td :colspan="6">
                  <InputText v-model="r.label" @change="touch"
                             :placeholder="r.kind === 'brk' ? '準備 / 移動 / 昼休憩' : 'S T A F F 入 り'"
                             class="wide" />
                </td>
                <td v-if="r.kind === 'brk'" class="w-dur">
                  <InputText v-model="r.dur" @change="touch" placeholder="0:10" class="num" />
                </td>
                <td v-else></td>
                <td :colspan="cast.length"></td>
              </template>

              <td class="w-act">
                <div class="acts">
                  <Button icon="pi pi-chevron-up" text rounded size="small"
                          :disabled="Number(i) === 0" @click="move(Number(i), -1)" aria-label="上へ" />
                  <Button icon="pi pi-chevron-down" text rounded size="small"
                          :disabled="Number(i) === rows.length - 1" @click="move(Number(i), 1)" aria-label="下へ" />
                  <Button icon="pi pi-trash" text rounded size="small" severity="danger"
                          @click="remove(Number(i))" aria-label="削除" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="add">
        <span>末尾に足す：</span>
        <Button label="シーン" icon="pi pi-plus" size="small" outlined
                @click="add('sc', rows.length - 1)" />
        <Button label="準備・移動" icon="pi pi-plus" size="small" outlined severity="secondary"
                @click="add('brk', rows.length - 1)" />
        <Button label="見出し" icon="pi pi-plus" size="small" outlined severity="secondary"
                @click="add('banner', rows.length - 1)" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.block h3 {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.9rem;
}

.fields label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.fields label.check {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  align-self: end;
  padding-bottom: 0.5rem;
  color: var(--p-text-color);
  font-weight: 600;
}

.hint {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  margin: 0.9rem 0 0;
  line-height: 1.7;
}

/* 進行表。横に長いので、この中だけ横スクロールさせる */
.grid-wrap {
  overflow-x: auto;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
}

.grid {
  border-collapse: collapse;
  font-size: 0.82rem;
  min-width: 100%;
}

.grid th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--p-surface-100);
  text-align: left;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
  font-weight: 700;
  padding: 0.5rem 0.4rem;
  border-bottom: 1px solid var(--p-content-border-color);
  white-space: nowrap;
}

.grid td {
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid var(--p-content-border-color);
  vertical-align: middle;
}

.grid tr.banner td {
  background: var(--p-surface-100);
}

.grid tr:hover td {
  background: var(--p-surface-50);
}

.grid :deep(.p-inputtext),
.grid :deep(.p-select) {
  width: 100%;
  font-size: 0.82rem;
  padding: 0.25rem 0.45rem;
}

.grid :deep(textarea) {
  min-height: 2rem;
  resize: vertical;
}

.num,
.grid :deep(.num) {
  font-variant-numeric: tabular-nums;
}

.center {
  text-align: center;
}

.w-ord { width: 2.5rem; color: var(--p-text-muted-color); }
.w-kind { width: 5.5rem; }
.w-sc { min-width: 5rem; }
.w-pillar { min-width: 8rem; }
.w-dn { min-width: 6.5rem; }
.w-dur { width: 5rem; }
.w-place { min-width: 8rem; }
.w-note { min-width: 16rem; }
.w-cast { width: 3.2rem; }
.w-act { width: 6.5rem; }

/* 配役の列見出しは、役名とキャスト名を2段で */
.w-cast .role {
  display: block;
  font-weight: 700;
  color: var(--p-text-color);
}

.w-cast .who {
  display: block;
  font-weight: 400;
  font-size: 0.92em;
  opacity: 0.75;
}

.wide {
  width: 100%;
}

.acts {
  display: flex;
  gap: 0;
}

.add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.9rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  flex-wrap: wrap;
}
</style>
