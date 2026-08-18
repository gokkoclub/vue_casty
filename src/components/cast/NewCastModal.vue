<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import { extractInstagramUsername } from '@/utils/imageUrl'
import { useCasts } from '@/composables/useCasts'
import { useToast } from 'primevue/usetoast'
import type { Cast } from '@/types'

const props = defineProps<{
    visible: boolean
    existingCasts?: Cast[]
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
    saved: [cast: Cast]
    'select-existing': [cast: Cast]
}>()

const toast = useToast()
const { addCast } = useCasts()
const saving = ref(false)
const nameError = ref(false)
const instagramError = ref('')

const form = reactive({
    name: '',
    gender: '' as '' | '男性' | '女性',
    agency: '',
    email: '',
    instagram: '',
    noInstagram: false,
})

// URL でも @ユーザー名 でも受け付けて、プロフィールURLに正規化する
function normalizeInstagramInput(input: string): string {
    const trimmed = input.trim()
    if (!trimmed) return ''
    if (/instagram\.com/i.test(trimmed)) {
        const username = extractInstagramUsername(trimmed)
        return username ? `https://www.instagram.com/${username}/` : ''
    }
    const bare = trimmed.replace(/^@/, '')
    if (/^[A-Za-z0-9._]+$/.test(bare)) return `https://www.instagram.com/${bare}/`
    return ''
}

// 表記ゆれを吸収して比較するための正規化（空白除去 + 小文字化 + カタカナ→ひらがな）
function normalizeName(s: string): string {
    return s
        .replace(/[\s　]+/g, '')
        .toLowerCase()
        .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

// 入力名に部分一致する登録済みキャスト（重複登録防止のサジェスト）
const similarCasts = computed<Cast[]>(() => {
    const query = normalizeName(form.name)
    if (!query || !props.existingCasts?.length) return []
    return props.existingCasts
        .filter(cast => {
            const name = normalizeName(cast.name)
            const furigana = normalizeName((cast as any).furigana || '')
            return name.includes(query) || query.includes(name) ||
                (furigana && (furigana.includes(query) || query.includes(furigana)))
        })
        .slice(0, 5)
})

// 完全一致するキャストがいる場合は強めに警告
const exactMatchCast = computed<Cast | null>(() => {
    const query = normalizeName(form.name)
    if (!query) return null
    return props.existingCasts?.find(cast => normalizeName(cast.name) === query) || null
})

function handleSelectExisting(cast: Cast) {
    emit('select-existing', cast)
    emit('update:visible', false)
    resetForm()
}

const genderOptions = [
    { label: '未選択', value: '' },
    { label: '男性', value: '男性' },
    { label: '女性', value: '女性' },
]

function resetForm() {
    form.name = ''
    form.gender = ''
    form.agency = ''
    form.email = ''
    form.instagram = ''
    form.noInstagram = false
    nameError.value = false
    instagramError.value = ''
}

async function handleSave() {
    // バリデーション
    if (!form.name.trim()) {
        nameError.value = true
        return
    }
    nameError.value = false

    let instagramUrl = ''
    if (!form.noInstagram) {
        if (!form.instagram.trim()) {
            instagramError.value = 'Instagram は必須です。やっていない場合はチェックを入れてください'
            return
        }
        instagramUrl = normalizeInstagramInput(form.instagram)
        if (!instagramUrl) {
            instagramError.value = 'Instagram のプロフィールURL または ユーザー名を入力してください'
            return
        }
    }
    instagramError.value = ''
    saving.value = true

    try {
        const castData: Omit<Cast, 'id' | 'createdAt' | 'updatedAt'> = {
            name: form.name.trim(),
            gender: form.gender || '',
            agency: form.agency.trim() || '外部',
            email: form.email.trim(),
            castType: '外部',
            imageUrl: '',
            snsInstagram: instagramUrl,
            slackMentionId: '',
            appearanceCount: 0,
        }

        // Firestore に保存（onSnapshot リスナーで自動反映される）
        const docId = await addCast(castData)

        // 保存されたキャストデータを親に返す
        const savedCast: Cast = {
            ...castData,
            id: docId || '',
        } as Cast

        toast.add({
            severity: 'success',
            summary: '登録完了',
            detail: `外部キャスト「${form.name}」を登録しました`,
            life: 3000
        })

        emit('saved', savedCast)
        emit('update:visible', false)
        resetForm()
    } catch (error: any) {
        console.error('Failed to save cast:', error)
        const errorMsg = error?.code === 'permission-denied'
            ? 'セッションが切れています。再サインインしてください。'
            : `キャストの登録に失敗しました: ${error?.message || '不明なエラー'}`
        toast.add({
            severity: 'error',
            summary: 'エラー',
            detail: errorMsg,
            life: 5000
        })
    } finally {
        saving.value = false
    }
}

function handleClose() {
    emit('update:visible', false)
    resetForm()
}
</script>

<template>
    <Dialog
        :visible="visible"
        @update:visible="emit('update:visible', $event)"
        modal
        header="＋ 新規外部キャストを追加"
        :style="{ width: '480px' }"
        @hide="resetForm"
    >
        <div class="new-cast-form">
            <!-- 名前（必須） -->
            <div class="form-field">
                <label for="new-cast-name">名前 <span class="required">*</span></label>
                <InputText
                    id="new-cast-name"
                    v-model="form.name"
                    placeholder="キャスト名を入力"
                    :class="{ 'p-invalid': nameError }"
                    class="w-full"
                    @input="nameError = false"
                />
                <small v-if="nameError" class="p-error">名前は必須です</small>

                <!-- 登録済みキャストのサジェスト（重複登録防止） -->
                <div v-if="similarCasts.length > 0" class="similar-casts">
                    <div class="similar-casts-header">
                        <i class="pi pi-question-circle"></i>
                        <span>もしかしてこの人ですか？（クリックでカートに追加）</span>
                    </div>
                    <button
                        v-for="cast in similarCasts"
                        :key="cast.id"
                        type="button"
                        class="similar-cast-item"
                        @click="handleSelectExisting(cast)"
                    >
                        <span class="similar-cast-name">{{ cast.name }}</span>
                        <span class="similar-cast-meta">{{ cast.agency || 'フリー' }} / {{ cast.castType }}</span>
                    </button>
                    <small v-if="exactMatchCast" class="exact-match-warning">
                        <i class="pi pi-exclamation-triangle"></i>
                        同名のキャスト「{{ exactMatchCast.name }}」が既に登録されています。別人の場合のみ保存してください。
                    </small>
                </div>
            </div>

            <!-- 性別 -->
            <div class="form-field">
                <label for="new-cast-gender">性別</label>
                <Select
                    id="new-cast-gender"
                    v-model="form.gender"
                    :options="genderOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="未選択"
                    class="w-full"
                />
            </div>

            <!-- Instagram（必須・チェックでスキップ可） -->
            <div class="form-field">
                <label for="new-cast-instagram">Instagram <span v-if="!form.noInstagram" class="required">*</span></label>
                <InputText
                    id="new-cast-instagram"
                    v-model="form.instagram"
                    placeholder="https://www.instagram.com/xxxx/ または @ユーザー名"
                    :class="{ 'p-invalid': !!instagramError }"
                    class="w-full"
                    :disabled="form.noInstagram"
                    @input="instagramError = ''"
                />
                <small v-if="instagramError" class="p-error">{{ instagramError }}</small>
                <div class="no-instagram-check">
                    <Checkbox
                        v-model="form.noInstagram"
                        inputId="new-cast-no-instagram"
                        binary
                        @change="instagramError = ''"
                    />
                    <label for="new-cast-no-instagram">Instagram をやっていない（入力をスキップ）</label>
                </div>
                <small v-if="!form.noInstagram" class="field-hint">
                    アイコン画像が未設定の場合、Instagram のプロフィール画像をアイコンとして表示します
                </small>
            </div>

            <!-- 所属 -->
            <div class="form-field">
                <label for="new-cast-agency">所属</label>
                <InputText
                    id="new-cast-agency"
                    v-model="form.agency"
                    placeholder="未入力時は「外部」がセットされます"
                    class="w-full"
                />
            </div>

            <!-- メール -->
            <div class="form-field">
                <label for="new-cast-email">メールアドレス</label>
                <InputText
                    id="new-cast-email"
                    v-model="form.email"
                    type="email"
                    placeholder="example@email.com"
                    class="w-full"
                />
            </div>

            <div class="form-info">
                <i class="pi pi-info-circle"></i>
                <span>
                    外部キャストとして登録されます。画像 / SNS / 特記事項 (NG・アレルギー・金額・備考) は
                    Notion 側で追加してください。次回同期で反映されます。
                </span>
            </div>
        </div>

        <template #footer>
            <div class="form-actions">
                <Button label="キャンセル" severity="secondary" @click="handleClose" />
                <Button
                    label="保存してカートに追加"
                    icon="pi pi-check"
                    @click="handleSave"
                    :loading="saving"
                />
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.new-cast-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.form-field label {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-color-secondary);
}

.required {
    color: var(--red-500, #ef4444);
}

.no-instagram-check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.25rem;
}

.no-instagram-check label {
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--text-color-secondary);
    cursor: pointer;
}

.field-hint {
    font-size: 0.75rem;
    color: var(--text-color-secondary);
}

.similar-casts {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.35rem;
    padding: 0.6rem;
    background: var(--yellow-50, #fefce8);
    border: 1px solid var(--yellow-200, #fde68a);
    border-radius: 6px;
}

.similar-casts-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--yellow-700, #a16207);
    margin-bottom: 0.15rem;
}

.similar-cast-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: var(--surface-0, #ffffff);
    border: 1px solid var(--surface-200, #e5e7eb);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    font-size: 0.85rem;
}

.similar-cast-item:hover {
    background: var(--blue-50, #eff6ff);
    border-color: var(--blue-300, #93c5fd);
}

.similar-cast-name {
    font-weight: 600;
}

.similar-cast-meta {
    font-size: 0.75rem;
    color: var(--text-color-secondary);
    white-space: nowrap;
}

.exact-match-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    margin-top: 0.25rem;
    font-size: 0.78rem;
    color: var(--red-600, #dc2626);
    font-weight: 600;
}

.form-info {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--blue-50, #eff6ff);
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--blue-600, #2563eb);
}

.form-info i {
    margin-top: 0.1rem;
}

.form-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
}
</style>
