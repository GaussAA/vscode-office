import { Button, Modal, Radio } from "antd";
import { useState } from "react";
import { t } from "./excel_i18n";

interface ExcelSaveAsDialogProps {
  open: boolean;
  onCancel: () => void;
  onSave: (format: string) => void;
}

/** Save-As format picker; the parent owns the export and the visible/closed state. */
export default function ExcelSaveAsDialog({ open, onCancel, onSave }: ExcelSaveAsDialogProps) {
  const [format, setFormat] = useState("xlsx");
  return (
    <Modal
      open={open}
      title={t("button.saveAs")}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} style={{ padding: "3px 12px", height: "auto" }}>
          {t("button.cancel")}
        </Button>,
        <Button
          key="ok"
          type="primary"
          onClick={() => onSave(format)}
          style={{ padding: "3px 12px", height: "auto" }}
        >
          {t("button.save")}
        </Button>,
      ]}
      getContainer={() => document.body}
      centered
      width={360}
    >
      <div style={{ padding: "8px 0 16px" }}>
        <div style={{ marginBottom: 12, opacity: 0.65, fontSize: 12 }}>
          {t("viewer.chooseExportFormat")}
        </div>
        <Radio.Group
          value={format}
          onChange={(event) => setFormat(event.target.value as string)}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {[
            {
              value: "xlsx",
              label: t("viewer.exportXlsxLabel"),
              desc: t("viewer.exportXlsxDesc"),
            },
            { value: "csv", label: t("viewer.exportCsvLabel"), desc: t("viewer.exportCsvDesc") },
            { value: "xls", label: t("viewer.exportXlsLabel"), desc: t("viewer.exportXlsDesc") },
            { value: "ods", label: t("viewer.exportOdsLabel"), desc: t("viewer.exportOdsDesc") },
          ].map((option) => (
            <Radio key={option.value} value={option.value} style={{ alignItems: "flex-start" }}>
              <span style={{ fontWeight: 500 }}>{option.label}</span>
              <span style={{ display: "block", fontSize: 11, opacity: 0.55, marginTop: 1 }}>
                {option.desc}
              </span>
            </Radio>
          ))}
        </Radio.Group>
      </div>
    </Modal>
  );
}
