import { ref } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'

/**
 * Helper to send a generated PDF to a deal's client via WhatsApp.
 *
 * Flow:
 *   1. Caller produces a PDF Blob (via pdfMake `getBlob` or jsPDF `output('blob')`).
 *   2. We turn it into a File and POST to `/upload?folder=whatsapp-docs` —
 *      same upload path the partner already uses for contract photos, so
 *      no new storage rules needed.
 *   3. We POST the resulting URL + filename + dealId to `/whatsapp/send-document`,
 *      which checks ownership server-side and forwards to WaSender.
 *
 * The `sending` ref is exposed so callers can disable the trigger button
 * during the round-trip. Confirmation/UX is the caller's responsibility —
 * keep this composable a thin transport layer.
 */
export function useSendPdfWhatsApp() {
  const sending = ref(false)
  const toast = useToast()

  async function sendPdf(args: {
    blob: Blob
    fileName: string
    dealId: string
    caption?: string
    /** Override; otherwise backend uses the deal's clientProfile/client phone. */
    phone?: string
    /** Suppress the success toast (caller might prefer their own). */
    silent?: boolean
  }): Promise<{ sent: boolean; phone?: string } | null> {
    sending.value = true
    try {
      // Wrap Blob in File so the storage helper preserves the .pdf name.
      const file = new File([args.blob], args.fileName, {
        type: args.blob.type || 'application/pdf',
      })
      const url = await api.upload(file, 'whatsapp-docs')
      const res = await api.post<{ sent: boolean; phone: string }>('/whatsapp/send-document', {
        dealId: args.dealId,
        documentUrl: url,
        fileName: args.fileName,
        caption: args.caption,
        phone: args.phone,
      })
      if (res.sent) {
        if (!args.silent) toast.success('Документ отправлен в WhatsApp')
      } else {
        toast.error('WhatsApp отказал в отправке')
      }
      return res
    } catch (e: any) {
      toast.error(e.message || 'Не удалось отправить документ')
      return null
    } finally {
      sending.value = false
    }
  }

  return { sending, sendPdf }
}
