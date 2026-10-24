import { useId, useState } from 'react';
import { Button, Card, Empty, Field, Loading, Modal, Notice, SectionTitle } from '../ui/primitives';
import { Calendar } from '../ui/calendar';
import { Checkbox } from '../ui/checkbox';
import { Switch, SwitchThumb } from '../ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectItemText, SelectPortal, SelectPositioner, SelectTrigger, SelectValue } from '../ui/select';
import './gallery.css';

/** Local-only component states. These fixtures never call application or provider APIs. */
export function ComponentGallery() {
  const checkboxId = useId();
  const switchId = useId();
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [date, setDate] = useState<Date>();
  const [density, setDensity] = useState('comfortable');
  return <div className="container developer-gallery">
    <SectionTitle eyebrow="Development only" title="Component workbench" description="Real controls, local sample state. No customer data or provider requests. Production returns 404." />
    <p>Source: src/components/developer/gallery.tsx. Try Tab, Shift+Tab, Escape, arrow keys, narrow width, dark theme and reduced motion.</p>
    <Tabs defaultValue="forms">
      <TabsList className="gallery-tabs" aria-label="Component groups">
        <TabsTrigger value="forms">Forms and overlays</TabsTrigger>
        <TabsTrigger value="states">Async states</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>
      <TabsContent value="forms">
        <div className="gallery-grid">
          <Card title="Validated form" description="Submit blank, then supply a name. The error is linked to its field.">
            <form className="form-stack" noValidate onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }}>
              <Field label="Project name" value={name} onChange={(event) => { setName(event.target.value); setSubmitted(false); }} error={submitted && !name.trim() ? 'Enter a project name.' : undefined} hint="A local demonstration, not a saved project." />
              <div className="row"><Button type="submit">Validate</Button><Button type="button" variant="secondary" onClick={() => { setName(''); setSubmitted(false); }}>Reset</Button></div>
              {submitted && name.trim() && <Notice kind="success">Valid: {name}</Notice>}
            </form>
          </Card>
          <Card title="Dialog and selection" description="The dialog uses the same Modal used by settings; Escape and Close dismiss it.">
            <div className="form-stack">
              <Button type="button" onClick={() => setDialog(true)}>Open dialog</Button>
              <label className="row" htmlFor={checkboxId}><Checkbox id={checkboxId} /> Receive sample updates (not persisted)</label>
              <label className="row" htmlFor={switchId}><Switch id={switchId} checked={enabled} onCheckedChange={setEnabled} className="gallery-switch"><SwitchThumb /></Switch> Compact layout: {enabled ? 'on' : 'off'}</label>
              <Select value={density} onValueChange={(value) => { if (value) setDensity(value); }}>
                <SelectTrigger className="button secondary" aria-label="Display density"><SelectValue /></SelectTrigger>
                <SelectPortal><SelectPositioner sideOffset={8}><SelectContent className="gallery-select">
                  {['comfortable', 'compact'].map((value) => <SelectItem key={value} value={value}><SelectItemText>{value}</SelectItemText></SelectItem>)}
                </SelectContent></SelectPositioner></SelectPortal>
              </Select>
              <p role="status">Selected density: {density}</p>
            </div>
          </Card>
        </div>
      </TabsContent>
      <TabsContent value="states">
        <div className="gallery-grid">
          <Card title="Loading"><Loading /><Button busy>Saving</Button></Card>
          <Card title="Empty"><Empty title="Nothing here yet">A real product should explain the next action.</Empty></Card>
          <Card title="Error"><Notice kind="error">Example request failed. Keep useful input and offer a retry.</Notice><Button variant="secondary" onClick={() => setDialog(true)}>Example recovery</Button></Card>
          <Card title="Success"><Notice kind="success">Example saved. This is fixture data.</Notice></Card>
        </div>
      </TabsContent>
      <TabsContent value="calendar"><Card title="Keyboard date picker" description="Dates use UTC. Arrow keys move focus, Page Up/Down change month, Home/End move within the week.">
        <Calendar initialMonth={new Date('2026-10-01T00:00:00Z')} selected={date} onSelect={setDate} />
        <p role="status">{date ? date.toISOString().slice(0, 10) : 'No date selected.'}</p>
      </Card></TabsContent>
    </Tabs>
    {dialog && <Modal title="Example dialog" onClose={() => setDialog(false)}><p>Focus stays in the dialog while open. Dismiss it and check that focus returns to the trigger.</p><Button type="button" onClick={() => setDialog(false)}>Done</Button></Modal>}
  </div>;
}
