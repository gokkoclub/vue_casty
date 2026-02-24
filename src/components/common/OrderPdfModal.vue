<script setup lang="ts">
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { usePdfGenerator } from '@/composables/usePdfGenerator'
import type { OrderDocumentData } from '@/composables/usePdfGenerator'
import { useShootingContact } from '@/composables/useShootingContact'
import type { ShootingContact } from '@/types'

const props = defineProps<{
    visible: boolean
    contact: ShootingContact | null
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
}>()

const { loading, generateOrderDocument } = usePdfGenerator()
const { updateContact } = useShootingContact()

// 編集用フォームデータ（7フィールド）
const formDate = ref('')
const formCastName = ref('')
const formProject = ref('')
const formRole = ref('')
const formShootDate = ref('')
const formCost = ref('')
const formNote = ref('')
const uuid = ref('')

// contact が変わったらフォーム初期化
watch(() => props.contact, (c) => {
    if (!c) return
    const today = new Date()
    formDate.value = today.toLocaleDateString('ja-JP')
    formCastName.value = c.castName || ''
    formProject.value = c.projectName || ''
    formRole.value = c.roleName || ''
    formShootDate.value = c.shootDate?.toDate()
        ? c.shootDate.toDate().toLocaleDateString('ja-JP')
        : ''
    formCost.value = c.cost || (c.fee ? String(c.fee) : '')
    formNote.value = ''
    // UUID: 既存があれば再利用、なければ新規生成
    uuid.value = c.poUuid || crypto.randomUUID()
}, { immediate: true })

async function handleGenerate() {
    if (!props.contact) return

    // 1. UUID を Firestore に保存
    if (!props.contact.poUuid) {
        await updateContact(props.contact.id, { poUuid: uuid.value })
    }

    // 2. 編集データをPDF生成関数に渡す
    const data: OrderDocumentData = {
        date: formDate.value,
        castName: formCastName.value,
        project: formProject.value,
        role: formRole.value,
        shootDate: formShootDate.value,
        cost: formCost.value,
        note: formNote.value,
        uuid: uuid.value
    }

    await generateOrderDocument(data)
    emit('update:visible', false)
}
</script>

<template>
    <Dialog
        :visible="visible"
        @update:visible="emit('update:visible', $event)"
        modal
        header="発注書作成"
        :style="{ width: '520px' }"
    >
        <div v-if="contact" class="pdf-form">
            <div class="field">
                <label>発行日</label>
                <InputText v-model="formDate" class="w-full" />
            </div>

            <div class="field">
                <label>宛名（キャスト名）</label>
                <InputText v-model="formCastName" class="w-full" />
            </div>

            <div class="field">
                <label>案件名</label>
                <InputText v-model="formProject" class="w-full" />
            </div>

            <div class="field">
                <label>役名</label>
                <InputText v-model="formRole" class="w-full" />
            </div>

            <div class="field">
                <label>撮影日</label>
                <InputText v-model="formShootDate" class="w-full" />
            </div>

            <div class="field">
                <label>金額（半角数字）</label>
                <InputText v-model="formCost" class="w-full" placeholder="18000" />
            </div>

            <div class="field">
                <label>備考</label>
                <Textarea v-model="formNote" rows="3" class="w-full" placeholder="備考があれば入力" />
            </div>

            <div class="uuid-display">
                <small>発注書番号: <code>{{ uuid }}</code></small>
            </div>
        </div>

        <template #footer>
            <Button
                label="キャンセル"
                icon="pi pi-times"
                severity="secondary"
                outlined
                @click="emit('update:visible', false)"
            />
            <Button
                label="PDFを作成"
                icon="pi pi-file-pdf"
                :loading="loading"
                @click="handleGenerate"
            />
        </template>
    </Dialog>
</template>

<style scoped>
.pdf-form {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

.field label {
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--text-color-secondary);
}

.uuid-display {
    padding: 0.5rem;
    background: var(--surface-50);
    border-radius: 4px;
    text-align: center;
}

.uuid-display code {
    font-size: 0.75rem;
    background: var(--surface-200);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
}
</style>
