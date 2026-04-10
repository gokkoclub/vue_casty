<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEmailTemplate } from '@/composables/useEmailTemplate'
import type { EmailTemplateType } from '@/composables/useEmailTemplate'
import type { ShootingContact, ShootingContactStatus } from '@/types'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
    contact: ShootingContact
    status: ShootingContactStatus
}>()

const emit = defineEmits<{
    close: []
    advance: [id: string]
}>()

const toast = useToast()
const { generateMail, getDefaultTemplate, allTemplates, copyToClipboard, openMailto } = useEmailTemplate()

const selectedTemplate = ref<EmailTemplateType>(getDefaultTemplate(props.status))
const mail = computed(() => generateMail(props.contact, selectedTemplate.value))

// 編集可能なフィールド
const editSubject = ref('')
const editBody = ref('')

// テンプレートが変わったら初期値をセット
watch([mail, selectedTemplate], () => {
    if (mail.value) {
        editSubject.value = mail.value.subject
        editBody.value = mail.value.body
    }
}, { immediate: true })

const resetToTemplate = () => {
    if (mail.value) {
        editSubject.value = mail.value.subject
        editBody.value = mail.value.body
    }
}

async function handleCopyAndAdvance() {
    await copyToClipboard(`${editSubject.value}\n\n${editBody.value}`)
    toast.add({ severity: 'success', summary: 'コピー完了', detail: 'クリップボードにコピーしました', life: 2000 })
    emit('advance', props.contact.id)
}

async function handleCopy() {
    await copyToClipboard(`${editSubject.value}\n\n${editBody.value}`)
    toast.add({ severity: 'success', summary: 'コピー完了', detail: 'クリップボードにコピーしました', life: 2000 })
}

function handleMailto() {
    if (!props.contact.email) {
        toast.add({ severity: 'warn', summary: '警告', detail: 'メールアドレスが設定されていません', life: 3000 })
        return
    }
    openMailto(props.contact.email!, editSubject.value, editBody.value)
}
</script>

<template>
    <div class="mail-modal">
        <div class="mail-modal-header">
            <h3>✉️ メール作成</h3>
            <button class="close-btn" @click="emit('close')">✕</button>
        </div>
        <div class="mail-modal-body">
            <!-- テンプレート選択セクション -->
            <div class="mail-section template-section">
                <label>テンプレート:</label>
                <select v-model="selectedTemplate">
                    <option v-for="t in allTemplates" :key="t" :value="t">{{ t }}</option>
                </select>
                <button class="btn-reset" @click="resetToTemplate" title="テンプレートの内容にリセット">🔄 リセット</button>
            </div>

            <!-- 宛先セクション -->
            <div v-if="contact.email" class="mail-section to-section">
                <label>To:</label>
                <span>{{ contact.email }}</span>
            </div>

            <!-- 件名セクション -->
            <div class="mail-section">
                <label class="section-label">件名:</label>
                <input
                    v-model="editSubject"
                    class="subject-input"
                />
            </div>

            <!-- 本文セクション -->
            <div class="mail-section body-section">
                <label class="section-label">本文:</label>
                <textarea v-model="editBody" rows="12"></textarea>
            </div>
        </div>

        <!-- アクションバー -->
        <div class="mail-actions">
            <button class="btn btn-primary" @click="handleCopyAndAdvance">📋 コピーして閉じる（ステータス更新）</button>
            <button class="btn btn-secondary" @click="handleCopy">📋 コピーのみ</button>
            <button class="btn btn-secondary" @click="handleMailto">✉️ メーラーで開く</button>
        </div>
    </div>
</template>

<style scoped>
.mail-modal {
    background: var(--p-content-background);
    border-radius: 12px;
    width: 600px;
    max-width: 95vw;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
}

.mail-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 2px solid var(--p-primary-color);
    background: var(--p-content-hover-background);
}

.mail-modal-header h3 { margin: 0; font-size: 1.1rem; }

.close-btn {
    background: none;
    border: none;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: var(--p-text-muted-color);
}
.close-btn:hover { background: var(--p-content-hover-background); }

.mail-modal-body {
    padding: 0;
    flex: 1;
    overflow-y: auto;
}

/* セクション共通 */
.mail-section {
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--p-content-border-color);
}

.mail-section:last-child {
    border-bottom: none;
}

/* テンプレート選択 */
.template-section {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--p-content-hover-background);
}

.template-section label {
    font-weight: 600;
    font-size: 0.85rem;
    white-space: nowrap;
    color: var(--p-text-muted-color);
}

.template-section select {
    flex: 1;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
    font-size: 0.85rem;
}

.btn-reset {
    background: none;
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font-size: 0.75rem;
    cursor: pointer;
    color: var(--p-text-muted-color);
    white-space: nowrap;
}
.btn-reset:hover { background: var(--p-content-border-color); }

/* 宛先 */
.to-section {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.85rem;
    background: var(--p-content-hover-background);
}
.to-section label { font-weight: 600; color: var(--p-text-muted-color); }

/* セクションラベル */
.section-label {
    display: block;
    font-weight: 700;
    font-size: 0.8rem;
    margin-bottom: 0.4rem;
    color: var(--p-primary-color);
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.subject-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--p-content-hover-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
    font-size: 0.9rem;
    font-family: inherit;
    color: var(--p-text-color);
    box-sizing: border-box;
}

/* 本文 */
.body-section {
    padding-bottom: 1rem;
}

.body-section textarea {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
    font-size: 0.85rem;
    font-family: inherit;
    resize: vertical;
    background: var(--p-content-hover-background);
    line-height: 1.6;
    color: var(--p-text-color);
    box-sizing: border-box;
}

/* アクションバー */
.mail-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.75rem 1.25rem;
    border-top: 2px solid var(--p-content-border-color);
    background: var(--p-content-hover-background);
}

.btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: background 0.2s;
}

.btn-primary {
    background: var(--p-primary-color);
    color: white;
}
.btn-primary:hover { filter: brightness(0.9); }

.btn-secondary {
    background: var(--p-content-hover-background);
    color: var(--p-text-color);
}
.btn-secondary:hover { background: var(--p-content-border-color); }
</style>
