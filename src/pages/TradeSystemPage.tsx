import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Save, Upload } from 'lucide-react'
import { Badge } from '../components/shared/Badge'
import { Button } from '../components/shared/Button'
import { DataTable, Td } from '../components/shared/DataTable'
import { Field, Input, Textarea } from '../components/shared/Field'
import { EmptyState, Panel } from '../components/shared/Panel'
import { commands } from '../lib/commands'
import type { MaterialRecord } from '../lib/types'
import { toErrorMessage } from '../lib/format'

const starterMarkdown = `# 我的趋势交易系统

## 系统定位

裸 K / 趋势交易系统。

## 数据需求

日 K、周 K、月 K。

## 入选条件

- 趋势结构清晰。

## 评分规则

- 趋势结构 35 分。
- 量价配合 25 分。
- 多周期一致性 25 分。
- 风险边界 15 分。

## 交易计划规则

- 观察：
- 入场：
- 止损：
- 止盈：
- 不交易：

## 复盘输出格式

输出 JSON：score、rating、overall_evaluation、core_reasons、evidence、trade_plan、chart_annotations、uncertainty。
`

export function TradeSystemPage({
  selectedVersionId,
  onSelectVersion
}: {
  selectedVersionId?: string
  onSelectVersion: (versionId: string | undefined) => void
}) {
  const queryClient = useQueryClient()
  const [selectedSystemId, setSelectedSystemId] = useState<string | undefined>()
  const [name, setName] = useState('我的趋势交易系统')
  const [markdown, setMarkdown] = useState(starterMarkdown)
  const [changeSummary, setChangeSummary] = useState('')
  const [materialPath, setMaterialPath] = useState('')
  const [materials, setMaterials] = useState<MaterialRecord[]>([])
  const [exportPath, setExportPath] = useState('')

  const systemsQuery = useQuery({
    queryKey: ['trade-systems'],
    queryFn: commands.listTradeSystems
  })
  const selectedSystem = useMemo(
    () => systemsQuery.data?.find(system => system.id === selectedSystemId),
    [selectedSystemId, systemsQuery.data]
  )
  const detailQuery = useQuery({
    queryKey: ['trade-system-detail', selectedSystemId],
    queryFn: () => commands.getTradeSystem(selectedSystemId!),
    enabled: Boolean(selectedSystemId)
  })
  const completenessQuery = useQuery({
    queryKey: ['completeness', markdown],
    queryFn: () => commands.checkTradeSystemCompleteness(markdown),
    enabled: markdown.trim().length > 0
  })

  useEffect(() => {
    if (!selectedSystemId && systemsQuery.data?.[0]) {
      setSelectedSystemId(systemsQuery.data[0].id)
    }
  }, [selectedSystemId, systemsQuery.data])

  useEffect(() => {
    const version = detailQuery.data?.versions.find(item => item.id === selectedVersionId) ?? detailQuery.data?.versions[0]
    if (version) {
      setName(detailQuery.data?.name ?? name)
      setMarkdown(version.markdown)
      onSelectVersion(version.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQuery.data])

  const saveMutation = useMutation({
    mutationFn: () =>
      commands.saveTradeSystemVersion(selectedSystemId ?? null, name, markdown, changeSummary || undefined),
    onSuccess: version => {
      setSelectedSystemId(version.tradeSystemId)
      onSelectVersion(version.id)
      void queryClient.invalidateQueries({ queryKey: ['trade-systems'] })
      void queryClient.invalidateQueries({ queryKey: ['trade-system-detail'] })
    }
  })
  const importMutation = useMutation({
    mutationFn: () => commands.importMaterial(selectedSystemId ?? null, materialPath),
    onSuccess: material => {
      setMaterials(previous => [material, ...previous])
      setMaterialPath('')
    }
  })
  const draftMutation = useMutation({
    mutationFn: () => commands.generateTradeSystemDraft(materials.map(material => material.id)),
    onSuccess: draft => setMarkdown(draft.markdown)
  })
  const exportMutation = useMutation({
    mutationFn: () => {
      if (!selectedVersionId) throw new Error('请先保存并选择版本')
      return commands.exportTradeSystemVersion(selectedVersionId, exportPath)
    }
  })

  return (
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <Panel title="交易系统列表">
        <div className="grid gap-2">
          {(systemsQuery.data ?? []).map(system => (
            <button
              className={`border px-3 py-2 text-left text-sm ${
                selectedSystemId === system.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted'
              }`}
              key={system.id}
              onClick={() => setSelectedSystemId(system.id)}
              type="button"
            >
              <div className="font-medium">{system.name}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>v{system.activeVersion ?? '-'}</span>
                <Badge tone={system.completenessStatus === 'complete' ? 'success' : 'warning'}>
                  {system.completenessStatus ?? 'draft'}
                </Badge>
              </div>
            </button>
          ))}
          {(systemsQuery.data ?? []).length === 0 ? (
            <EmptyState title="还没有交易系统" detail="在右侧编辑 Markdown 后保存第一个版本。" />
          ) : null}
        </div>
      </Panel>

      <div className="grid gap-4">
        <Panel
          title="Markdown 编辑器"
          action={
            <Button
              icon={<Save className="h-4 w-4" />}
              variant="primary"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              保存版本
            </Button>
          }
        >
          <div className="mb-3 grid grid-cols-[240px_1fr] gap-3">
            <Field label="名称">
              <Input value={name} onChange={event => setName(event.target.value)} />
            </Field>
            <Field label="变更摘要">
              <Input value={changeSummary} onChange={event => setChangeSummary(event.target.value)} />
            </Field>
          </div>
          <Textarea className="min-h-[520px] font-mono text-xs" value={markdown} onChange={event => setMarkdown(event.target.value)} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={completenessQuery.data?.canScore ? 'success' : 'warning'}>
              {completenessQuery.data?.status ?? 'checking'}
            </Badge>
            {(completenessQuery.data?.missingSections ?? []).map(item => (
              <Badge key={item} tone="danger">
                缺 {item}
              </Badge>
            ))}
            {(completenessQuery.data?.warnings ?? []).slice(0, 3).map(item => (
              <span className="text-muted-foreground" key={item}>
                {item}
              </span>
            ))}
          </div>
          {saveMutation.isError ? <p className="mt-2 text-xs text-danger">{toErrorMessage(saveMutation.error)}</p> : null}
        </Panel>

        <div className="grid grid-cols-2 gap-4">
          <Panel
            title="材料导入"
            action={
              <Button
                icon={<Upload className="h-4 w-4" />}
                disabled={!materialPath || importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                导入
              </Button>
            }
          >
            <Field label="本地文件路径">
              <Input value={materialPath} onChange={event => setMaterialPath(event.target.value)} />
            </Field>
            <Button
              className="mt-3"
              icon={<FileText className="h-4 w-4" />}
              disabled={materials.length === 0 || draftMutation.isPending}
              onClick={() => draftMutation.mutate()}
            >
              生成草案
            </Button>
            <DataTable columns={['文件', '状态']}>
              {materials.map(material => (
                <tr key={material.id}>
                  <Td>{material.fileName}</Td>
                  <Td>{material.parseStatus}</Td>
                </tr>
              ))}
            </DataTable>
          </Panel>

          <Panel
            title="版本与导出"
            action={
              <Button
                icon={<Download className="h-4 w-4" />}
                disabled={!selectedVersionId || !exportPath || exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
              >
                导出
              </Button>
            }
          >
            <Field label="导出路径">
              <Input value={exportPath} onChange={event => setExportPath(event.target.value)} />
            </Field>
            <div className="mt-3">
              <DataTable columns={['版本', '状态', 'Hash', '创建时间']}>
                {(detailQuery.data?.versions ?? []).map(version => (
                  <tr
                    className="cursor-pointer hover:bg-muted"
                    key={version.id}
                    onClick={() => {
                      onSelectVersion(version.id)
                      setMarkdown(version.markdown)
                    }}
                  >
                    <Td>v{version.version}</Td>
                    <Td>{version.completenessStatus}</Td>
                    <Td className="font-mono text-xs">{version.contentHash.slice(0, 10)}</Td>
                    <Td>{version.createdAt}</Td>
                  </tr>
                ))}
              </DataTable>
            </div>
            {selectedSystem ? <p className="mt-2 text-xs text-muted-foreground">当前：{selectedSystem.name}</p> : null}
          </Panel>
        </div>
      </div>
    </div>
  )
}

