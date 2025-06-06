import { programLanderAccordionBlockSchema } from "@/lib/zod/schemas/program-lander";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@dub/ui";
import { z } from "zod";
import { BlockMarkdown } from "./block-markdown";
import { BlockTitle } from "./block-title";

export function AccordionBlock({
  block,
}: {
  block: z.infer<typeof programLanderAccordionBlockSchema>;
}) {
  return (
    <div className="space-y-5">
      <BlockTitle title={block.data.title} />
      <div className="border-y border-slate-200">
        <Accordion type="multiple">
          {block.data.items.map((item, idx) => (
            <AccordionItem key={idx} value={idx.toString()}>
              <AccordionTrigger className="py-2" variant="plus">
                <h3 className="text-left md:text-lg">{item.title}</h3>
              </AccordionTrigger>
              <AccordionContent>
                <BlockMarkdown className="py-2">{item.content}</BlockMarkdown>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
