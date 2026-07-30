// Declaração para o subpath interno do pdf-parse.
// Importamos 'pdf-parse/lib/pdf-parse.js' diretamente (em vez de 'pdf-parse')
// para evitar o código de debug do index.js, que tenta ler um PDF de teste
// (./test/data/05-versions-space.pdf) e quebra em ambiente serverless.
// O pacote @types/pdf-parse só declara o módulo 'pdf-parse', não o subpath.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PDFParseResult {
    text: string
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    version: string
  }
  function pdfParse(dataBuffer: Buffer, options?: unknown): Promise<PDFParseResult>
  export default pdfParse
}
