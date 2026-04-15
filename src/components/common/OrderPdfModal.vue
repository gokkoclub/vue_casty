<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import SelectButton from 'primevue/selectbutton'
import { usePdfGenerator } from '@/composables/usePdfGenerator'
import type { OrderDocumentData, OrderDocumentDataV2 } from '@/composables/usePdfGenerator'
import { useShootingContact } from '@/composables/useShootingContact'
import type { ShootingContact } from '@/types'

const props = defineProps<{
    visible: boolean
    contact: ShootingContact | null
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
}>()

const { loading, generateOrderDocument, generateOrderDocumentV2 } = usePdfGenerator()
const { updateContact } = useShootingContact()

// ── バージョン選択 ──
const formatVersion = ref<'v1' | 'v2'>('v1')
const versionOptions = [
    { label: '旧フォーマット', value: 'v1' },
    { label: '新フォーマット（事務所向け）', value: 'v2' },
]

// ── 共通フィールド ──
const formDate = ref('')
const formAgencyName = ref('')
const formCastName = ref('')
const formProject = ref('')
const formRole = ref('')
const formShootDate = ref('')
const formCost = ref('')
const formNote = ref('')
const uuid = ref('')

// ── V2 追加フィールド ──
const formRecipientPostal = ref('')
const formRecipientAddress = ref('')
const formSubject = ref('')
const formIssuerName = ref('')
const formDeliveryDate = ref('')
const formDeliveryPlace = ref('')
const formPaymentDate = ref('')
const formItemDescription = ref('')

// ── 発注書番号（V2用 P-OR形式）生成 ──
function generateOrderNumber(): string {
    const now = new Date()
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')
    return `P-OR${ym}-${seq}`
}

// ── 支払予定日の自動計算（撮影月の翌月末） ──
function calcPaymentDate(shootDateStr: string): string {
    try {
        const parts = shootDateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
        if (!parts) return ''
        const y = parseInt(parts[1]!)
        const m = parseInt(parts[2]!) // 1-based
        // 翌月末 = 翌々月の0日
        const nextMonthEnd = new Date(y, m + 1, 0)
        return `${nextMonthEnd.getFullYear()}-${String(nextMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(nextMonthEnd.getDate()).padStart(2, '0')}`
    } catch {
        return ''
    }
}

// ── contact が変わったらフォーム初期化 ──
watch(() => props.contact, (c) => {
    if (!c) return
    // デフォルト発行日: 撮影日の前日
    if (c.shootDate?.toDate) {
        const shootDay = new Date(c.shootDate.toDate())
        shootDay.setDate(shootDay.getDate() - 1)
        formDate.value = shootDay.toLocaleDateString('ja-JP')
    } else {
        formDate.value = new Date().toLocaleDateString('ja-JP')
    }
    formAgencyName.value = c.agencyName || ''
    formCastName.value = c.castName || ''
    formProject.value = c.projectName || ''
    formRole.value = c.roleName || ''
    formShootDate.value = c.shootDate?.toDate()
        ? c.shootDate.toDate().toLocaleDateString('ja-JP')
        : ''
    formCost.value = c.cost || (c.fee ? String(c.fee) : '')
    formNote.value = ''
    uuid.value = c.poUuid || crypto.randomUUID()

    // V2 フィールド初期化
    formRecipientPostal.value = ''
    formRecipientAddress.value = ''
    formSubject.value = `${c.projectName || ''} 出演`
    formIssuerName.value = ''
    formDeliveryDate.value = formShootDate.value
    formDeliveryPlace.value = ''
    formPaymentDate.value = formShootDate.value ? calcPaymentDate(formShootDate.value) : ''
    formItemDescription.value = `${c.projectName || ''} 出演`

    // 事務所名があればデフォルトで新フォーマット
    if (c.agencyName) {
        formatVersion.value = 'v2'
    }
}, { immediate: true })

// ── V2用: 金額をパース ──
const parsedCost = computed(() => {
    const num = Number(formCost.value.replace(/[^0-9]/g, ''))
    return isNaN(num) ? 0 : num
})

// ── 生成 ──
async function handleGenerate() {
    if (!props.contact) return

    // UUID を Firestore に保存
    if (!props.contact.poUuid) {
        await updateContact(props.contact.id, { poUuid: uuid.value })
    }

    if (formatVersion.value === 'v2') {
        const data: OrderDocumentDataV2 = {
            orderDate: formDate.value,
            orderNumber: generateOrderNumber(),
            recipientName: formAgencyName.value || formCastName.value,
            recipientPostal: formRecipientPostal.value,
            recipientAddress: formRecipientAddress.value,
            issuerName: formIssuerName.value,
            subject: formSubject.value || `${formProject.value} 出演`,
            itemDescription: formItemDescription.value || `${formProject.value} 出演`,
            itemQuantity: 1,
            itemUnit: '式',
            itemUnitPrice: parsedCost.value,
            deliveryDate: formDeliveryDate.value,
            deliveryPlace: formDeliveryPlace.value,
            paymentDate: formPaymentDate.value,
            castName: formCastName.value,
            note: formNote.value,
        }
        await generateOrderDocumentV2(data)
    } else {
        const data: OrderDocumentData = {
            date: formDate.value,
            agencyName: formAgencyName.value,
            castName: formCastName.value,
            project: formProject.value,
            role: formRole.value,
            shootDate: formShootDate.value,
            cost: formCost.value,
            note: formNote.value,
            uuid: uuid.value
        }
        await generateOrderDocument(data)
    }
    emit('update:visible', false)
}
</script>

<template>
    <Dialog
        :visible="visible"
        @update:visible="emit('update:visible', $event)"
        modal
        header="発注書作成"
        :style="{ width: '560px', maxHeight: '90vh' }"
    >
        <div v-if="contact" class="pdf-form">
            <!-- バージョン選択 -->
            <div class="version-select">
                <SelectButton
                    v-model="formatVersion"
                    :options="versionOptions"
                    optionLabel="label"
                    optionValue="value"
                    :allowEmpty="false"
                />
            </div>

            <!-- 共通: 発行日 -->
            <div class="field">
                <label>発注日</label>
                <InputText v-model="formDate" class="w-full" />
            </div>

            <!-- ======================== V1 フィールド ======================== -->
            <template v-if="formatVersion === 'v1'">
                <div class="field">
                    <label>事務所名（任意）</label>
                    <InputText v-model="formAgencyName" class="w-full" placeholder="事務所名があれば入力" />
                    <small v-if="formAgencyName" style="color: var(--p-primary-color);">宛名: {{ formAgencyName }}宛 / キャスト名は明細に表示</small>
                    <small v-else style="color: var(--text-color-secondary);">未入力の場合、キャスト名宛で発行されます</small>
                </div>
                <div class="field">
                    <label>キャスト名</label>
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
            </template>

            <!-- ======================== V2 フィールド ======================== -->
            <template v-if="formatVersion === 'v2'">
                <div class="section-label">宛先（事務所情報）</div>
                <div class="field">
                    <label>宛名</label>
                    <InputText v-model="formAgencyName" class="w-full" placeholder="例: 株式会社サンプルエージェンシー" />
                </div>
                <div class="field-row">
                    <div class="field" style="flex: 0 0 120px;">
                        <label>郵便番号</label>
                        <InputText v-model="formRecipientPostal" class="w-full" placeholder="100-0001" />
                    </div>
                    <div class="field" style="flex: 1;">
                        <label>住所</label>
                        <InputText v-model="formRecipientAddress" class="w-full" placeholder="東京都千代田区..." />
                    </div>
                </div>

                <div class="section-label">発注内容</div>
                <div class="field">
                    <label>件名</label>
                    <InputText v-model="formSubject" class="w-full" placeholder="例: ドラマ撮影出演" />
                </div>
                <div class="field">
                    <label>摘要（明細の説明）</label>
                    <InputText v-model="formItemDescription" class="w-full" placeholder="例: ドラマ出演料" />
                </div>
                <div class="field-row">
                    <div class="field" style="flex: 1;">
                        <label>キャスト名</label>
                        <InputText v-model="formCastName" class="w-full" />
                    </div>
                    <div class="field" style="flex: 1;">
                        <label>金額（税抜・半角数字）</label>
                        <InputText v-model="formCost" class="w-full" placeholder="18000" />
                    </div>
                </div>
                <!-- 税プレビュー -->
                <div v-if="parsedCost > 0" class="tax-preview">
                    <span>税抜: ¥{{ parsedCost.toLocaleString() }}</span>
                    <span>消費税(10%): ¥{{ Math.round(parsedCost * 0.1).toLocaleString() }}</span>
                    <span style="font-weight: 700;">合計: ¥{{ Math.round(parsedCost * 1.1).toLocaleString() }}</span>
                </div>

                <div class="section-label">納品・支払</div>
                <div class="field-row">
                    <div class="field" style="flex: 1;">
                        <label>納品期限</label>
                        <InputText v-model="formDeliveryDate" class="w-full" placeholder="撮影日" />
                    </div>
                    <div class="field" style="flex: 1;">
                        <label>支払予定日</label>
                        <InputText v-model="formPaymentDate" class="w-full" placeholder="自動計算" />
                    </div>
                </div>
                <div class="field">
                    <label>納品場所</label>
                    <InputText v-model="formDeliveryPlace" class="w-full" placeholder="空欄ならGOKKOオフィス住所" />
                </div>

                <div class="section-label">その他</div>
                <div class="field">
                    <label>発注者（担当者名）</label>
                    <InputText v-model="formIssuerName" class="w-full" placeholder="空欄なら GOKKO倶楽部キャスティング担当" />
                </div>
                <div class="field">
                    <label>追加備考</label>
                    <Textarea v-model="formNote" rows="2" class="w-full" placeholder="定型文以外に追加があれば" />
                </div>
            </template>
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
                :label="formatVersion === 'v2' ? 'PDF作成（新）' : 'PDF作成（旧）'"
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
    gap: 0.75rem;
    max-height: 65vh;
    overflow-y: auto;
    padding-right: 4px;
}

.version-select {
    display: flex;
    justify-content: center;
    margin-bottom: 0.25rem;
}

.section-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--p-primary-color);
    border-bottom: 1px solid var(--p-content-border-color);
    padding-bottom: 0.2rem;
    margin-top: 0.25rem;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.field label {
    font-weight: 600;
    font-size: 0.78rem;
    color: var(--text-color-secondary);
}

.field-row {
    display: flex;
    gap: 0.75rem;
}

.tax-preview {
    display: flex;
    gap: 1rem;
    font-size: 0.78rem;
    padding: 0.4rem 0.6rem;
    background: var(--p-content-hover-background);
    border-radius: 4px;
    color: var(--p-text-color);
}

.uuid-display {
    padding: 0.5rem;
    background: var(--p-content-hover-background);
    border-radius: 4px;
    text-align: center;
}

.uuid-display code {
    font-size: 0.75rem;
    background: var(--p-content-border-color);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
}
</style>
