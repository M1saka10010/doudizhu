import { useState } from 'react';
import { checkAiConnection, type AiSettings } from '../ai/client';

export function SettingsModal({ settings, onSave, onClose }: {
  settings: AiSettings;
  onSave: (s: AiSettings) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AiSettings>(settings);
  const [health, setHealth] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const set = (k: keyof AiSettings, v: string) => setForm(f => ({ ...f, [k]: v }));

  const checkConnection = async () => {
    setChecking(true);
    try {
      await checkAiConnection(form);
      setHealth({ ok: true, text: '接口连接正常' });
    } catch (error) {
      setHealth({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
    setChecking(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="AI 设置">
        <h2>AI 设置</h2>
        <p className="modal-desc">
          浏览器会直接调用 OpenAI 兼容接口，通过工具调用决策叫地主与出牌。接口必须支持 tools，
          并允许浏览器跨域请求 (CORS)。配置只保存在当前浏览器。
        </p>

        <label className="field">
          <span>接口地址 (Base URL)</span>
          <input
            value={form.baseUrl}
            onChange={e => set('baseUrl', e.target.value)}
            placeholder="https://api.openai.com/v1 或 https://api.deepseek.com/v1"
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={form.apiKey}
            onChange={e => set('apiKey', e.target.value)}
            placeholder="sk-..."
          />
        </label>
        <label className="field">
          <span>模型</span>
          <input
            value={form.model}
            onChange={e => set('model', e.target.value)}
            placeholder="gpt-4o / deepseek-chat / qwen-plus ..."
          />
        </label>

        <div className="modal-actions">
          <button className="btn ghost" onClick={checkConnection} disabled={checking}>
            {checking ? '检测中…' : '检测接口'}
          </button>
          {health && <span className={`health ${health.ok ? 'ok' : 'fail'}`}>{health.text}</span>}
          <button className="btn" onClick={() => onSave(form)}>保存</button>
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>

        <p className="modal-hint">安全提示：静态网页无法隐藏密钥，请仅填写你自己的 API Key，不要在公共设备上保存。</p>
      </div>
    </div>
  );
}
