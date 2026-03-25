'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';

interface QrCodeDialogProps {
  open: boolean;
  onClose: () => void;
  linkId: string | null;
  linkTitle?: string;
}

export function QrCodeDialog({ open, onClose, linkId, linkTitle }: QrCodeDialogProps) {
  const [loading, setLoading] = useState(false);
  const [qrData, setQrData] = useState<{ url: string; qrcode: string } | null>(null);

  useEffect(() => {
    if (open && linkId) {
      setLoading(true);
      api
        .get(`/shortlinks/${linkId}/qrcode`)
        .then((res) => setQrData(res.data.data))
        .catch((err) => console.error('QR code error:', err))
        .finally(() => setLoading(false));
    } else {
      setQrData(null);
    }
  }, [open, linkId]);

  const handleDownload = () => {
    if (!qrData?.qrcode) return;
    const a = document.createElement('a');
    a.href = qrData.qrcode;
    a.download = `qr-${linkTitle || 'shortlink'}.png`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>QR Code</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center space-y-4">
          {loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : qrData ? (
            <>
              <img src={qrData.qrcode} alt="QR Code" className="w-64 h-64" />
              <p className="text-sm text-muted-foreground break-all text-center">{qrData.url}</p>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>關閉</Button>
          {qrData && (
            <Button onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" /> 下載
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
