<script setup lang="ts">
/**
 * 作品からのクイック追加オーダーモーダル（宮澤+三浦アカウント限定）
 * 既存オーダー(base casting)の作品・日程を引き継ぎ、キャストを複数選んで役名を入力し、
 * 初期ステータス（外部=オーダー待ち / 内部=仮キャスティング）で追加オーダーする。
 */
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { useCasts } from '@/composables/useCasts'
import type { Cast, Casting } from '@/types'

const props = defineProps<{
    visible: boolean
    base: Casting | null
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
    confirm: [items: Array<{ cast: Cast; roleName: string; mainSub: 'メイン' | 'サブ' | 'その他' }>]
}>()

const { casts, fetchAll, loading: castsLoading } = useCasts()

interface Row {
    cast: Cast | null
    roleName: string
    mainSub: 'メイン' | 'サブ' | 'その他'
}
const rows = ref<Row[]>([{ cast: null, roleName: '', mainSub: 'その他' }])
const submitting = ref(false)

const mainSubOptions = ['メイン', 'サブ', 'その他']

watch(() => props.visible, (v) => {
    if (v) {
        rows.value = [{ cast: null, roleName: '', mainSub: 'その他' }]
        if (casts.value.length === 0) fetchAll()
    }
})

const castOptions = computed(() =>
    casts.value.map(c => ({ ...c, label: `${c.name}（${c.castType}${c.agency ? '・' + c.agency : ''}）` }))
)

const dateLabel = computed(() => {
    const d = props.base?.startDate?.toDate?.()
    if (!d) return ''
    return `${d.getMonth() + 1}/${d.getDate()}`
})

const validItems = computed(() =>
    rows.value.filter(r => r.cast && r.roleName.trim())
        .map(r => ({ cast: r.cast!, roleName: r.roleName.trim(), mainSub: r.mainSub }))
)

function addRow() {
    rows.value.push({ cast: null, roleName: '', mainSub: 'その他' })
}
function removeRow(i: number) {
    rows.value.splice(i, 1)
    if (rows.value.length === 0) addRow()
}

async function submit() {
    if (validItems.value.length === 0) return
    submitting.value = true
    try {
        emit('confirm', validItems.value)
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <Dialog
        :visible="visible"
        @update:visible="emit('update:visible', $event)"
        modal
        header="追加オーダー"
        :style="{ width: '620px' }"
    >
        <div v-if="base" class="qao-base">
            <span class="qao-project">{{ base.projectName }}</span>
            <Tag :value="dateLabel" severity="info" />
            <Tag v-if="base.accountName" :value="base.accountName" severity="secondary" />
        </div>
        <p class="qao-help">
            キャストと役名を入力してください。初期ステータス（外部=オーダー待ち / 内部=仮キャスティング）で追加され、
            Slackの既存スレッドに追加オーダーとして投稿されます。候補番号は既存の続きから自動採番されます。
        </p>

        <div v-for="(row, i) in rows" :key="i" class="qao-row">
            <Select
                v-model="row.cast"
                :options="castOptions"
                optionLabel="label"
                filter
                :loading="castsLoading"
                placeholder="キャストを選択"
                class="qao-cast"
            />
            <InputText v-model="row.roleName" placeholder="役名" class="qao-role" />
            <Select v-model="row.mainSub" :options="mainSubOptions" class="qao-mainsub" />
            <Button icon="pi pi-times" text severity="danger" @click="removeRow(i)" v-tooltip.top="'行を削除'" />
        </div>

        <Button label="キャストを追加" icon="pi pi-plus" text size="small" @click="addRow" />

        <template #footer>
            <Button label="キャンセル" text @click="emit('update:visible', false)" />
            <Button
                :label="`追加オーダー送信（${validItems.length}名）`"
                icon="pi pi-send"
                :disabled="validItems.length === 0"
                :loading="submitting"
                @click="submit"
            />
        </template>
    </Dialog>
</template>

<style scoped>
.qao-base { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.qao-project { font-weight: 700; }
.qao-help { font-size: 0.8rem; color: var(--text-color-secondary); margin: 0 0 0.75rem; }
.qao-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
.qao-cast { flex: 1; min-width: 220px; }
.qao-role { width: 130px; }
.qao-mainsub { width: 110px; }
</style>
