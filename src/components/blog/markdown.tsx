import { marked, type Token, type Tokens } from 'marked';
import { safeImageSource, safeHref } from './image';
function Inline({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        const key = `${token.type}-${index}`;
        switch (token.type) {
          case 'strong':
            return (
              <strong key={key}>
                <Inline tokens={(token as Tokens.Strong).tokens} />
              </strong>
            );
          case 'em':
            return (
              <em key={key}>
                <Inline tokens={(token as Tokens.Em).tokens} />
              </em>
            );
          case 'del':
            return (
              <del key={key}>
                <Inline tokens={(token as Tokens.Del).tokens} />
              </del>
            );
          case 'image': {
            const image = token as Tokens.Image;
            const src = safeImageSource(image.href);
            return src ? (
              <img
                key={key}
                src={src}
                alt={image.text}
                title={image.title || undefined}
                loading="lazy"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            ) : (
              <span key={key}>{image.text}</span>
            );
          }
          case 'codespan':
            return <code key={key}>{(token as Tokens.Codespan).text}</code>;
          case 'link': {
            const link = token as Tokens.Link;
            return (
              <a key={key} href={safeHref(link.href)}>
                <Inline tokens={link.tokens} />
              </a>
            );
          }
          case 'br':
            return <br key={key} />;
          default:
            return <span key={key}>{'text' in token ? String(token.text) : token.raw}</span>;
        }
      })}
    </>
  );
}
export function Markdown({ content }: { content: string }) {
  const tokens = marked.lexer(content);
  return (
    <div className="prose">
      {tokens.map((token, index) => {
        const key = `${token.type}-${index}`;
        switch (token.type) {
          case 'heading': {
            const heading = token as Tokens.Heading;
            const text = <Inline tokens={heading.tokens} />;
            return heading.depth <= 2 ? <h2 key={key}>{text}</h2> : <h3 key={key}>{text}</h3>;
          }
          case 'paragraph':
            return (
              <p key={key}>
                <Inline tokens={(token as Tokens.Paragraph).tokens} />
              </p>
            );
          case 'list': {
            const list = token as Tokens.List;
            const children = list.items.map((item) => (
              <li key={item.raw}>
                <Markdown content={item.text} />
              </li>
            ));
            return list.ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>;
          }
          case 'code':
            return (
              <pre key={key}>
                <code>{(token as Tokens.Code).text}</code>
              </pre>
            );
          case 'table': {
            const table = token as Tokens.Table;
            return (
              <div key={key} style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {table.header.map((cell, column) => {
                        const cellKey = `${column}-${cell.text}`;
                        return (
                          <th
                            key={cellKey}
                            scope="col"
                            style={{
                              textAlign: table.align[column] || undefined,
                            }}
                          >
                            <Inline tokens={cell.tokens} />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => {
                      const rowKey = `${rowIndex}-${row.map((cell) => cell.text).join('|')}`;
                      return (
                        <tr key={rowKey}>
                          {row.map((cell, column) => {
                            const cellKey = `${column}-${cell.text}`;
                            return (
                              <td
                                key={cellKey}
                                style={{
                                  textAlign: table.align[column] || undefined,
                                }}
                              >
                                <Inline tokens={cell.tokens} />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }
          case 'blockquote':
            return (
              <blockquote key={key}>
                <Markdown content={(token as Tokens.Blockquote).text} />
              </blockquote>
            );
          case 'hr':
            return <hr key={key} />;
          case 'space':
            return null;
          default:
            return <p key={key}>{'text' in token ? String(token.text) : token.raw}</p>;
        }
      })}
    </div>
  );
}
