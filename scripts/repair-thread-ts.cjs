/**
 * 修復: 特定キャスティングの slackThreadTs / slackChannel / slackPermalink を更新
 *
 * Usage:
 *   node scripts/repair-thread-ts.cjs <castingId> <slackThreadTs> [slackChannel] [slackPermalink]
 *
 * 例:
 *   node scripts/repair-thread-ts.cjs FWNtQEGcl2k4LUPC40d3 1776044163.722859 C02S1NFRH55 https://...
 */

const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const [castingId, slackThreadTs, slackChannel, slackPermalink] = process.argv.slice(2)
    if (!castingId || !slackThreadTs) {
        console.error('Usage: node repair-thread-ts.cjs <castingId> <slackThreadTs> [slackChannel] [slackPermalink]')
        process.exit(1)
    }

    const ref = db.collection('castings').doc(castingId)
    const snap = await ref.get()
    if (!snap.exists) {
        console.error(`Casting ${castingId} not found`)
        process.exit(1)
    }
    const before = snap.data()
    console.log('Before:', {
        castName: before.castName,
        slackThreadTs: before.slackThreadTs || '(empty)',
        slackChannel: before.slackChannel || '(empty)',
        slackPermalink: before.slackPermalink || '(empty)',
    })

    const update = { slackThreadTs }
    if (slackChannel) update.slackChannel = slackChannel
    if (slackPermalink) update.slackPermalink = slackPermalink

    await ref.update(update)
    const after = (await ref.get()).data()
    console.log('After:', {
        castName: after.castName,
        slackThreadTs: after.slackThreadTs,
        slackChannel: after.slackChannel,
        slackPermalink: after.slackPermalink,
    })
    console.log('OK')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
