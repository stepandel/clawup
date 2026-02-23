function renderYamlPart(text: string) {
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0 && !text.trimStart().startsWith("-")) {
    const key = text.slice(0, colonIdx);
    const value = text.slice(colonIdx);
    return (
      <>
        <span className="text-accent-coral">{key}</span>
        <span className="text-muted-foreground">{value}</span>
      </>
    );
  }
  return <span className="text-muted-foreground">{text}</span>;
}

export function renderYamlLine(line: string, i: number) {
  const commentIdx = line.indexOf("#");
  const colonIdx = line.indexOf(":");

  if (commentIdx > 0) {
    const before = line.slice(0, commentIdx);
    const comment = line.slice(commentIdx);
    return (
      <div key={i}>
        {renderYamlPart(before)}
        <span className="text-muted-foreground/50">{comment}</span>
      </div>
    );
  }

  if (colonIdx > 0 && !line.trimStart().startsWith("-") && !line.trimStart().startsWith("#")) {
    const key = line.slice(0, colonIdx);
    const value = line.slice(colonIdx);
    return (
      <div key={i}>
        <span className="text-accent-coral">{key}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
    );
  }
  return <div key={i}>{line || "\u00A0"}</div>;
}
